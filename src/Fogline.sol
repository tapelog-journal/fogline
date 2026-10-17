// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Fogline - a hidden-information strategy game played fully onchain.
/// @notice Two players (people or AI agents) each commit a hidden army as
///         per-piece salted hashes. Positions are public, ranks are hidden.
///         Moves are transactions. When pieces clash, both ranks are revealed
///         and checked against the commitments. Capture the enemy Beacon to win.
///         Optional ERC-20 stake is escrowed and paid to the verified winner.
/// @dev    TESTNET ONLY. The constructor refuses any chain that is not
///         Base Sepolia (84532) or a local dev chain (31337). Real-money
///         wagering on mainnet is disabled pending owner legal review.
///         Game for entertainment. Not investment advice.
contract Fogline is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- board
    uint8 public constant SIZE = 8; // 8x8 board, square = row*8 + col
    uint8 public constant PIECES = 16; // pieces per side
    uint8 public constant BLOCK_A = 26; // impassable "fog bank" (row 3, col 2)
    uint8 public constant BLOCK_B = 37; // impassable "fog bank" (row 4, col 5)
    uint8 public constant SCOUT_RANGE = 3; // scouts move 1..3 squares in a line
    uint16 public constant MAX_PLY = 400; // move cap -> draw, stakes refunded

    // ---------------------------------------------------------------- ranks
    uint8 public constant BEACON = 0; // immobile; capture it to win
    uint8 public constant GHOST = 1; // weakest, but defeats the Warden when it attacks
    uint8 public constant SCOUT = 2; // moves up to 3 squares; reveals itself when it does
    uint8 public constant SAPPER = 3; // defuses Mines
    uint8 public constant GUARD = 4;
    uint8 public constant KNIGHT = 5;
    uint8 public constant CAPTAIN = 6;
    uint8 public constant WARDEN = 7; // strongest
    uint8 public constant MINE = 8; // immobile, single-use: destroys attacker and itself (Sapper survives)
    uint8 internal constant NUM_RANKS = 9;

    /// @dev required army composition, indexed by rank. Sum = 16.
    function requiredCount(uint8 rank) public pure returns (uint8) {
        // Beacon1 Ghost1 Scout3 Sapper2 Guard3 Knight2 Captain1 Warden1 Mine2
        if (rank == BEACON || rank == GHOST || rank == CAPTAIN || rank == WARDEN) return 1;
        if (rank == SCOUT || rank == GUARD) return 3;
        if (rank == SAPPER || rank == KNIGHT || rank == MINE) return 2;
        return 0;
    }

    // ---------------------------------------------------------------- state
    enum Phase {
        None,
        Open, // created, waiting for opponent
        Committing, // both joined, waiting for layout commitments
        Playing, // side `turn` must move
        PendingReveal, // defender (side `turn`) must reveal the attacked piece
        Ended, // winner decided, waiting for winner to prove a legal layout
        Settled // stakes paid / refunded
    }

    enum EndReason {
        None,
        BeaconCaptured,
        Resigned,
        Timeout,
        DrawMaxPly,
        DrawNoCommit,
        Cancelled,
        IllegalReveal,
        WinnerUnverified
    }

    struct Piece {
        bytes32 commitment;
        uint8 pos; // square index, valid while alive
        uint8 rank; // only meaningful when revealed
        bool alive;
        bool revealed;
        bool moved;
    }

    struct Match {
        address[2] players; // [0] creator moves first, [1] joiner
        address token; // stake token, 0 when stake == 0
        uint256 stake; // per player
        uint32 turnTimeout; // seconds a side has to act
        Phase phase;
        uint8 turn; // side to act
        uint8 winner; // 0/1, 2 = none
        EndReason reason;
        uint64 deadline;
        uint16 ply;
        uint8 pendFrom; // pending combat squares
        uint8 pendTo;
        bool[2] committed;
        bool[2] verified;
    }

    uint256 public matchCount;
    mapping(uint256 => Match) internal _matches;
    mapping(uint256 => Piece[32]) internal _pieces; // 0..15 side 0, 16..31 side 1
    mapping(uint256 => uint8[64]) internal _board; // 0 empty, else pieceId+1

    uint32 public constant MIN_TIMEOUT = 60;
    uint32 public constant MAX_TIMEOUT = 7 days;

    // ---------------------------------------------------------------- events
    event MatchCreated(uint256 indexed id, address indexed creator, address indexed opponent, address token, uint256 stake, uint32 turnTimeout);
    event MatchJoined(uint256 indexed id, address indexed player);
    event LayoutCommitted(uint256 indexed id, uint8 side);
    event GameStarted(uint256 indexed id);
    event Moved(uint256 indexed id, uint8 side, uint8 from, uint8 to, uint16 ply);
    event Revealed(uint256 indexed id, uint8 pieceId, uint8 rank);
    event Attack(uint256 indexed id, uint8 side, uint8 from, uint8 to);
    event Combat(uint256 indexed id, uint8 attackerId, uint8 defenderId, uint8 attackerRank, uint8 defenderRank, uint8 outcome); // 0 attacker wins, 1 defender holds, 2 both removed
    event GameEnded(uint256 indexed id, uint8 winner, EndReason reason);
    event LayoutVerified(uint256 indexed id, uint8 side);
    event Settled(uint256 indexed id, uint8 winner, EndReason reason, uint256 payout);

    // ---------------------------------------------------------------- errors
    error WrongChain();
    error WrongPhase();
    error NotYourTurn();
    error NotPlayer();
    error BadSquare();
    error BadMove();
    error BadReveal();
    error Immobile();
    error NotExpired();
    error BadTimeout();
    error BadLayout();

    constructor() {
        // Deploy guard: wagering contract is testnet / local only.
        if (block.chainid != 84532 && block.chainid != 31337) revert WrongChain();
    }

    // ================================================================ lobby

    /// @notice Create a match. `opponent` = address(0) for an open match.
    function createMatch(address token, uint256 stake, uint32 turnTimeout, address opponent) external nonReentrant returns (uint256 id) {
        if (turnTimeout < MIN_TIMEOUT || turnTimeout > MAX_TIMEOUT) revert BadTimeout();
        if (stake > 0 && token == address(0)) revert BadMove();
        id = ++matchCount;
        Match storage m = _matches[id];
        m.players[0] = msg.sender;
        m.players[1] = opponent;
        m.token = stake > 0 ? token : address(0);
        m.stake = stake;
        m.turnTimeout = turnTimeout;
        m.phase = Phase.Open;
        m.winner = 2;
        if (stake > 0) IERC20(token).safeTransferFrom(msg.sender, address(this), stake);
        emit MatchCreated(id, msg.sender, opponent, m.token, stake, turnTimeout);
    }

    function joinMatch(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.Open) revert WrongPhase();
        if (msg.sender == m.players[0]) revert NotPlayer();
        if (m.players[1] != address(0) && m.players[1] != msg.sender) revert NotPlayer();
        m.players[1] = msg.sender;
        m.phase = Phase.Committing;
        m.deadline = uint64(block.timestamp) + m.turnTimeout;
        if (m.stake > 0) IERC20(m.token).safeTransferFrom(msg.sender, address(this), m.stake);
        emit MatchJoined(id, msg.sender);
    }

    /// @notice Creator may cancel before anyone joins; stake refunded.
    function cancelMatch(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.Open) revert WrongPhase();
        if (msg.sender != m.players[0]) revert NotPlayer();
        m.phase = Phase.Settled;
        m.reason = EndReason.Cancelled;
        if (m.stake > 0) IERC20(m.token).safeTransfer(m.players[0], m.stake);
        emit Settled(id, 2, EndReason.Cancelled, 0);
    }

    // ================================================================ setup

    /// @notice Hash a piece commitment. Off-chain agents compute the same.
    function pieceCommitment(uint256 id, address player, uint8 index, uint8 rank, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(id, player, index, rank, salt));
    }

    /// @notice Starting square of a piece. Side 0 fills rows 0-1, side 1 fills rows 6-7.
    function startSquare(uint8 side, uint8 index) public pure returns (uint8) {
        return side == 0 ? index : 48 + index;
    }

    /// @notice Commit 16 per-piece hashes. Piece i starts on startSquare(side, i).
    function commitLayout(uint256 id, bytes32[16] calldata commitments) external {
        Match storage m = _matches[id];
        if (m.phase != Phase.Committing) revert WrongPhase();
        uint8 side = _sideOf(m, msg.sender);
        if (m.committed[side]) revert WrongPhase();
        m.committed[side] = true;
        Piece[32] storage ps = _pieces[id];
        uint8[64] storage b = _board[id];
        for (uint8 i = 0; i < PIECES; i++) {
            uint8 pid = side * PIECES + i;
            uint8 sq = startSquare(side, i);
            ps[pid] = Piece({commitment: commitments[i], pos: sq, rank: 0, alive: true, revealed: false, moved: false});
            b[sq] = pid + 1;
        }
        emit LayoutCommitted(id, side);
        if (m.committed[0] && m.committed[1]) {
            m.phase = Phase.Playing;
            m.turn = 0;
            m.deadline = uint64(block.timestamp) + m.turnTimeout;
            emit GameStarted(id);
        }
    }

    // ================================================================ play

    /// @notice Move a piece. If `to` holds an enemy piece this is an attack and
    ///         the attacker must reveal (`rank`,`salt`) unless already revealed.
    ///         A move of more than one square must be made by a Scout, which
    ///         reveals it. For an ordinary one-square move pass any rank/salt.
    function move(uint256 id, uint8 from, uint8 to, uint8 rank, bytes32 salt) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.Playing) revert WrongPhase();
        uint8 side = m.turn;
        if (msg.sender != m.players[side]) revert NotYourTurn();
        if (from >= 64 || to >= 64 || to == BLOCK_A || to == BLOCK_B) revert BadSquare();
        uint8[64] storage b = _board[id];
        uint8 cell = b[from];
        if (cell == 0) revert BadSquare();
        uint8 pid = cell - 1;
        if (pid / PIECES != side) revert BadSquare();
        uint8 target = b[to];
        if (target != 0 && (target - 1) / PIECES == side) revert BadMove();

        uint8 dist = _lineDistance(b, from, to);
        Piece storage p = _pieces[id][pid];
        bool attack = target != 0;
        if (dist > 1 || attack) {
            _revealOwn(id, m, pid, rank, salt);
            if (dist > 1 && p.rank != SCOUT) revert BadMove();
        }
        if (p.revealed && (p.rank == BEACON || p.rank == MINE)) revert Immobile();
        p.moved = true;

        if (!attack) {
            b[from] = 0;
            b[to] = cell;
            p.pos = to;
            emit Moved(id, side, from, to, m.ply);
            _nextTurn(id, m);
            return;
        }
        emit Attack(id, side, from, to);
        Piece storage d = _pieces[id][target - 1];
        m.pendFrom = from;
        m.pendTo = to;
        if (d.revealed) {
            _resolve(id, m);
        } else {
            m.phase = Phase.PendingReveal;
            m.turn = 1 - side;
            m.deadline = uint64(block.timestamp) + m.turnTimeout;
        }
    }

    /// @notice Defender reveals the attacked piece; combat resolves.
    function revealDefense(uint256 id, uint8 rank, bytes32 salt) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.PendingReveal) revert WrongPhase();
        uint8 side = m.turn;
        if (msg.sender != m.players[side]) revert NotYourTurn();
        uint8 pid = _board[id][m.pendTo] - 1;
        _revealOwn(id, m, pid, rank, salt);
        Piece storage d = _pieces[id][pid];
        // A piece that has moved can never be a Beacon or Mine.
        if (d.moved && (d.rank == BEACON || d.rank == MINE)) {
            _end(id, m, 1 - side, EndReason.IllegalReveal);
            return;
        }
        _resolve(id, m);
    }

    function resign(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        uint8 side = _sideOf(m, msg.sender);
        if (m.phase == Phase.Committing) {
            // opponent can only win if it has an army to verify
            if (m.committed[1 - side]) _end(id, m, 1 - side, EndReason.Resigned);
            else _settleDraw(id, m, EndReason.Resigned);
            return;
        }
        if (m.phase != Phase.Playing && m.phase != Phase.PendingReveal) revert WrongPhase();
        _end(id, m, 1 - side, EndReason.Resigned);
    }

    /// @notice Anyone may call once the acting side's deadline passes.
    function claimTimeout(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (block.timestamp <= m.deadline) revert NotExpired();
        if (m.phase == Phase.Committing) {
            if (m.committed[0] == m.committed[1]) {
                // nobody committed: refund both
                _settleDraw(id, m, EndReason.DrawNoCommit);
            } else {
                _end(id, m, m.committed[0] ? 0 : 1, EndReason.Timeout);
            }
            return;
        }
        if (m.phase != Phase.Playing && m.phase != Phase.PendingReveal) revert WrongPhase();
        _end(id, m, 1 - m.turn, EndReason.Timeout);
    }

    // ================================================================ settlement

    /// @notice Winner proves its whole committed army was legal (right counts,
    ///         no Beacon/Mine ever moved) and collects the pot.
    function verifyLayout(uint256 id, uint8[16] calldata ranks, bytes32[16] calldata salts) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.Ended) revert WrongPhase();
        uint8 side = _sideOf(m, msg.sender);
        if (side != m.winner) revert NotPlayer();
        uint8[9] memory counts;
        Piece[32] storage ps = _pieces[id];
        for (uint8 i = 0; i < PIECES; i++) {
            uint8 r = ranks[i];
            if (r >= NUM_RANKS) revert BadLayout();
            Piece storage p = ps[side * PIECES + i];
            if (p.commitment != pieceCommitment(id, msg.sender, i, r, salts[i])) revert BadLayout();
            if (p.moved && (r == BEACON || r == MINE)) revert BadLayout();
            counts[r]++;
        }
        for (uint8 r = 0; r < NUM_RANKS; r++) {
            if (counts[r] != requiredCount(r)) revert BadLayout();
        }
        m.verified[side] = true;
        emit LayoutVerified(id, side);
        _settleWinner(id, m, m.winner, m.reason);
    }

    /// @notice If the winner cannot prove a legal army in time, the other side takes the pot.
    function claimUnverified(uint256 id) external nonReentrant {
        Match storage m = _matches[id];
        if (m.phase != Phase.Ended) revert WrongPhase();
        if (block.timestamp <= m.deadline) revert NotExpired();
        _settleWinner(id, m, 1 - m.winner, EndReason.WinnerUnverified);
    }

    // ================================================================ views

    function getMatch(uint256 id) external view returns (Match memory) {
        return _matches[id];
    }

    function getBoard(uint256 id) external view returns (uint8[64] memory) {
        return _board[id];
    }

    function getPieces(uint256 id) external view returns (Piece[32] memory) {
        return _pieces[id];
    }

    // ================================================================ internals

    function _sideOf(Match storage m, address who) internal view returns (uint8) {
        if (who == m.players[0]) return 0;
        if (who == m.players[1]) return 1;
        revert NotPlayer();
    }

    function _revealOwn(uint256 id, Match storage m, uint8 pid, uint8 rank, bytes32 salt) internal {
        Piece storage p = _pieces[id][pid];
        if (p.revealed) return;
        uint8 side = pid / PIECES;
        if (rank >= NUM_RANKS) revert BadReveal();
        if (p.commitment != pieceCommitment(id, m.players[side], pid % PIECES, rank, salt)) revert BadReveal();
        p.revealed = true;
        p.rank = rank;
        emit Revealed(id, pid, rank);
    }

    /// @dev returns distance along a straight orthogonal line with an empty path.
    function _lineDistance(uint8[64] storage b, uint8 from, uint8 to) internal view returns (uint8) {
        uint8 fr = from / SIZE;
        uint8 fc = from % SIZE;
        uint8 tr = to / SIZE;
        uint8 tc = to % SIZE;
        uint8 dist;
        int8 step;
        if (fr == tr && fc != tc) {
            dist = fc > tc ? fc - tc : tc - fc;
            step = fc > tc ? int8(-1) : int8(1);
        } else if (fc == tc && fr != tr) {
            dist = fr > tr ? fr - tr : tr - fr;
            step = fr > tr ? int8(-8) : int8(8);
        } else {
            revert BadMove();
        }
        if (dist > SCOUT_RANGE) revert BadMove();
        int16 sq = int16(uint16(from));
        for (uint8 k = 1; k < dist; k++) {
            sq += step;
            uint8 s = uint8(uint16(sq));
            if (b[s] != 0 || s == BLOCK_A || s == BLOCK_B) revert BadMove();
        }
        return dist;
    }

    function _resolve(uint256 id, Match storage m) internal {
        uint8[64] storage b = _board[id];
        uint8 from = m.pendFrom;
        uint8 to = m.pendTo;
        uint8 aId = b[from] - 1;
        uint8 dId = b[to] - 1;
        Piece storage a = _pieces[id][aId];
        Piece storage d = _pieces[id][dId];
        uint8 attSide = aId / PIECES;
        uint8 outcome = combatOutcome(a.rank, d.rank);
        emit Combat(id, aId, dId, a.rank, d.rank, outcome);
        if (outcome == 0) {
            d.alive = false;
            b[to] = aId + 1;
            b[from] = 0;
            a.pos = to;
        } else if (outcome == 1) {
            a.alive = false;
            b[from] = 0;
        } else {
            a.alive = false;
            d.alive = false;
            b[from] = 0;
            b[to] = 0;
        }
        if (outcome == 0 && d.rank == BEACON) {
            _end(id, m, attSide, EndReason.BeaconCaptured);
            return;
        }
        m.phase = Phase.Playing;
        m.turn = attSide;
        _nextTurn(id, m);
    }

    /// @notice 0 = attacker wins, 1 = defender holds, 2 = both removed.
    function combatOutcome(uint8 att, uint8 def) public pure returns (uint8) {
        if (def == BEACON) return 0;
        if (def == MINE) return att == SAPPER ? 0 : 2; // single-use mine
        if (att == GHOST && def == WARDEN) return 0; // ambush
        if (att > def) return 0;
        return 1; // ties: defender holds ground
    }

    function _nextTurn(uint256 id, Match storage m) internal {
        m.ply++;
        if (m.ply >= MAX_PLY) {
            _settleDraw(id, m, EndReason.DrawMaxPly);
            return;
        }
        m.turn = 1 - m.turn;
        m.deadline = uint64(block.timestamp) + m.turnTimeout;
    }

    function _end(uint256 id, Match storage m, uint8 winner, EndReason reason) internal {
        m.phase = Phase.Ended;
        m.winner = winner;
        m.reason = reason;
        m.deadline = uint64(block.timestamp) + m.turnTimeout; // window to verify layout
        emit GameEnded(id, winner, reason);
    }

    function _settleWinner(uint256 id, Match storage m, uint8 winner, EndReason reason) internal {
        m.phase = Phase.Settled;
        m.winner = winner;
        m.reason = reason;
        uint256 pot = m.stake * 2; // 0% fee
        if (pot > 0) IERC20(m.token).safeTransfer(m.players[winner], pot);
        emit Settled(id, winner, reason, pot);
    }

    function _settleDraw(uint256 id, Match storage m, EndReason reason) internal {
        m.phase = Phase.Settled;
        m.winner = 2;
        m.reason = reason;
        if (m.stake > 0) {
            IERC20(m.token).safeTransfer(m.players[0], m.stake);
            IERC20(m.token).safeTransfer(m.players[1], m.stake);
        }
        emit Settled(id, 2, reason, 0);
    }
}
