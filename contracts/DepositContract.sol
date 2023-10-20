// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./IDepositAddressFactory.sol";
/**
 * @title DepositContract
 * @notice This contract is designed to allow for secure deposits, management,
 * and transfer of ERC20 tokens, ERC721 tokens, and Ether to a designated cold storage.
 */
contract DepositContract is Initializable {
    using SafeERC20 for IERC20;

    address public coldStorage;

    function initialize(address _factory) public initializer {
        coldStorage = IDepositAddressFactory(_factory).coldStorage();
    }

    /**
     * @notice Transfers ERC20 tokens from this contract to the cold storage address.
     * @param tokenAddress The address of the ERC20 token to be transferred.
     */
    function sweepERC20Token(address tokenAddress, uint256 amount) external {
        IERC20 token = IERC20(tokenAddress);
        token.approve(msg.sender, amount);
        token.approve(address(this), amount);
        token.transferFrom(address(this), coldStorage, amount);
    }

    /**
     * @notice Transfers ERC721 tokens from this contract to the cold storage address.
     * @param nftAddress The address of the ERC721 token contract.
     * @param tokenIds The IDs of the ERC721 tokens to be transferred.
     */
    function sweepERC721Tokens(address nftAddress, uint256[] calldata tokenIds) external {
        IERC721 nft = IERC721(nftAddress);

        for (uint256 i = 0; i < tokenIds.length; i++) {
            nft.safeTransferFrom(address(this), coldStorage, tokenIds[i]);
        }
    }

    /**
     * @notice Transfers the Ether held in this contract to the cold storage address.
     */
    function sweepEther() external {
        uint256 ethBalance = address(this).balance;
        require(ethBalance > 0, "No Ether available for transfer");

        payable(coldStorage).transfer(ethBalance);
    }

    // Fallback function to allow the contract to receive Ether transfers
    receive() external payable {}
}
