// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Fogline Cosmetics - purely decorative piece skins and board themes.
/// @notice Items have NO gameplay effect; the Fogline game contract never reads
///         this contract. Items are bought with an ERC-20 (USDC-style) at a fixed
///         price, or minted by an approved minter after an off-chain payment
///         (e.g. an x402 pay-per-call endpoint). Players can mark one skin and one
///         board theme as "equipped" so viewers know what to render.
contract FoglineCosmetics is ERC1155, Ownable {
    using SafeERC20 for IERC20;

    enum Kind {
        PieceSkin,
        BoardTheme
    }

    struct Item {
        string name;
        Kind kind;
        uint256 price; // in paymentToken units; 0 = not for direct sale
        uint32 maxSupply; // 0 = unlimited
        uint32 minted;
        bool active;
    }

    IERC20 public immutable paymentToken;
    address public treasury;
    uint256 public itemCount;
    mapping(uint256 => Item) public items;
    mapping(address => bool) public minters;
    mapping(address => mapping(Kind => uint256)) public equipped; // 0 = default look

    event ItemAdded(uint256 indexed itemId, string name, Kind kind, uint256 price, uint32 maxSupply);
    event ItemUpdated(uint256 indexed itemId, uint256 price, bool active);
    event Purchased(address indexed buyer, uint256 indexed itemId, uint256 amount, uint256 paid);
    event Equipped(address indexed player, Kind kind, uint256 itemId);

    error Inactive();
    error SoldOut();
    error NotForSale();
    error NotOwned();
    error NotMinter();

    constructor(address paymentToken_, address treasury_, string memory uri_) ERC1155(uri_) Ownable(msg.sender) {
        paymentToken = IERC20(paymentToken_);
        treasury = treasury_;
    }

    // ---------------------------------------------------------------- admin
    function addItem(string calldata name, Kind kind, uint256 price, uint32 maxSupply) external onlyOwner returns (uint256 itemId) {
        itemId = ++itemCount;
        items[itemId] = Item({name: name, kind: kind, price: price, maxSupply: maxSupply, minted: 0, active: true});
        emit ItemAdded(itemId, name, kind, price, maxSupply);
    }

    function updateItem(uint256 itemId, uint256 price, bool active) external onlyOwner {
        Item storage it = items[itemId];
        it.price = price;
        it.active = active;
        emit ItemUpdated(itemId, price, active);
    }

    function setTreasury(address t) external onlyOwner {
        treasury = t;
    }

    function setMinter(address m, bool ok) external onlyOwner {
        minters[m] = ok;
    }

    function setURI(string calldata uri_) external onlyOwner {
        _setURI(uri_);
    }

    // ---------------------------------------------------------------- sales
    function buy(uint256 itemId, uint32 amount) external {
        Item storage it = _mintable(itemId, amount);
        if (it.price == 0) revert NotForSale();
        uint256 cost = it.price * amount;
        paymentToken.safeTransferFrom(msg.sender, treasury, cost);
        _mint(msg.sender, itemId, amount, "");
        emit Purchased(msg.sender, itemId, amount, cost);
    }

    /// @notice For sales settled elsewhere (e.g. x402 payment to the treasury).
    function mintTo(address to, uint256 itemId, uint32 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        _mintable(itemId, amount);
        _mint(to, itemId, amount, "");
        emit Purchased(to, itemId, amount, 0);
    }

    function equip(Kind kind, uint256 itemId) external {
        if (itemId != 0) {
            if (balanceOf(msg.sender, itemId) == 0) revert NotOwned();
            if (items[itemId].kind != kind) revert NotOwned();
        }
        equipped[msg.sender][kind] = itemId;
        emit Equipped(msg.sender, kind, itemId);
    }

    function _mintable(uint256 itemId, uint32 amount) internal returns (Item storage it) {
        it = items[itemId];
        if (!it.active) revert Inactive();
        if (it.maxSupply != 0 && uint256(it.minted) + amount > it.maxSupply) revert SoldOut();
        it.minted += amount;
    }

    // Unequip automatically when an equipped item is transferred away.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        super._update(from, to, ids, values);
        if (from != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                Kind k = items[ids[i]].kind;
                if (equipped[from][k] == ids[i] && balanceOf(from, ids[i]) == 0) {
                    equipped[from][k] = 0;
                    emit Equipped(from, k, 0);
                }
            }
        }
    }
}
