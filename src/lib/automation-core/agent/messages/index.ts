/**
 * Messages module exports
 */

export { MessageManager, MessageManagerSettings } from './service';
export { MessageHistory, MessageMetadata, ManagedMessage } from './views';
export {
  removeThinkTags,
  extractJsonFromModelOutput,
  convertInputMessages,
  filterExternalContent,
  wrapUntrustedContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
  UNTRUSTED_CONTENT_TAG_START,
  UNTRUSTED_CONTENT_TAG_END,
  USER_REQUEST_TAG_START,
  USER_REQUEST_TAG_END,
  ATTACHED_FILES_TAG_START,
  ATTACHED_FILES_TAG_END,
} from './utils';

