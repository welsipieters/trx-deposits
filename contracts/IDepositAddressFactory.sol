// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IDepositAddressFactory {
    function coldStorage() external view returns (address);
    function deployedContracts(address) external view returns (bool);
    function admins(address) external view returns (bool);
    function paused() external view returns (bool);

    function deployNewContract() external returns(address);
    function deployMultipleContracts(uint256 count) external returns(address[] memory);
    function getColdStorageAddress() external view returns (address);
    function setColdStorageAddress(address _coldStorage) external;
    function addAdmin(address _admin) external;
    function removeAdmin(address _admin) external;
    function pauseContract() external;
    function unpauseContract() external;
}
