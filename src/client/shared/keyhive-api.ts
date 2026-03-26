// Thin re-export facade — new code should import from '../worker-api' directly.
export {
  onKeyhiveStateChanged,
  getIdentity,
  getContactCard,
  receiveContactCard,
  getKnownContacts,
  getDocMembers,
  getMyAccess,
  listDevices,
  removeDevice,
  addMember,
  revokeMember,
  changeRole,
  generateInvite,
  dismissInvite,
  claimInvite,
  enableSharing,
  registerSharingGroup,
} from '../worker-api';
export type { DeviceInfo, IdentityInfo, MemberInfo } from '../worker-api';
