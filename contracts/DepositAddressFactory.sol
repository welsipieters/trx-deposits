
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";

import "./DepositContract.sol";
import "./IDepositAddressFactory.sol";

/**
 * @title DepositAddressFactory
 * @notice This contract facilitates the creation of new DepositContract instances. 
 * It also manages administrative tasks like pausing/unpausing operations, 
 * updating cold storage addresses, and maintaining a list of contract admins.
 */
contract DepositAddressFactory is Pausable, IDepositAddressFactory, Initializable  {

    // Address where assets are stored securely
    address public override coldStorage;

    address public logicContract;

    // Mapping to track contracts deployed by this factory
    mapping(address => bool) public override deployedContracts;

    // Mapping to track admin addresses
    mapping(address => bool) public override admins;

    event ContractDeployed(address contractAddress);

    // Modifier to ensure that the function is only callable by an admin
    modifier onlyAdmin() {
        require(admins[msg.sender], "Access restricted to admins");
        _;
    }

    /**
     * @dev Constructor to initialize the cold storage address and set the deployer as an admin.
     * @param _coldStorage Address of the cold storage.
     */
    function initialize(address _coldStorage, address _logicContract) public initializer {
        require(_coldStorage != address(0), "Invalid cold storage address");
        require(_logicContract != address(0), "Invalid logic contract address");
        coldStorage = _coldStorage;
        admins[msg.sender] = true;
        logicContract = _logicContract;
    }

    function deployNewContract() external override onlyAdmin whenNotPaused returns(address) {
        address payable clone = payable(Clones.clone(logicContract));

        deployedContracts[clone] = true;
        DepositContract(clone).initialize(address(this));
        emit ContractDeployed(clone);
        return clone;
    }

    function deployMultipleContracts(uint256 count) external override onlyAdmin whenNotPaused returns(address[] memory) {
        address[] memory deployedAddresses = new address[](count);
        for (uint256 i = 0; i < count; i++) {
            address payable clone = payable(Clones.clone(logicContract));

            deployedContracts[clone] = true;
            deployedAddresses[i] = clone;
            DepositContract(clone).initialize(address(this));
            emit ContractDeployed(clone);
        }
        return deployedAddresses;
    }

    /**
     * @notice Adds a new admin.
     * @param _admin Address of the new admin.
     */
    function addAdmin(address _admin) external override onlyAdmin {
        require(_admin != address(0), "Invalid admin address");
        admins[_admin] = true;
    }

    /**
     * @notice Removes an admin.
     * @param _admin Address of the admin to be removed.
     */
    function removeAdmin(address _admin) external override onlyAdmin {
        require(_admin != address(0), "Invalid admin address");
        admins[_admin] = false;
    }

    /**
     * @notice Returns the cold storage address.
     * @return Address of the cold storage.
     */
    function getColdStorageAddress() external override view returns (address) {
        return coldStorage;
    }

    /**
     * @notice Updates the cold storage address.
     * @param _coldStorage New cold storage address.
     */
    function setColdStorageAddress(address _coldStorage) external override onlyAdmin {
        require(_coldStorage != address(0), "Invalid cold storage address");
        coldStorage = _coldStorage;
    }

    function paused() override(Pausable, IDepositAddressFactory) public view returns (bool) {
        return Pausable.paused();
    }


/**
 * @notice Pauses all contract operations.
     */
    function pauseContract() external override onlyAdmin {
        _pause();
    }

    /**
     * @notice Resumes all contract operations.
     */
    function unpauseContract() external override onlyAdmin {
        _unpause();
    }
}
