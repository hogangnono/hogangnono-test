export function decideThreadReplyHandling(replyState, actionableMessage, options = {}) {
  const { allowReusableAssistantReply = false } = options;

  if (allowReusableAssistantReply && replyState.reusableAssistantReplyTs) {
    return {
      shouldSkip: false,
      reusableAssistantReplyTs: replyState.reusableAssistantReplyTs,
    };
  }

  if ((replyState.replyCount ?? 0) === 0) {
    return {
      shouldSkip: false,
      reusableAssistantReplyTs: null,
    };
  }

  if (!allowReusableAssistantReply) {
    return {
      shouldSkip: true,
      reusableAssistantReplyTs: null,
    };
  }

  const hasBlockingAssistantReply = actionableMessage.pendingReason
    ? replyState.hasAssistantFinalReply || replyState.hasAssistantWaitingReply || replyState.hasAssistantFailureReply
    : replyState.hasAssistantFinalReply;

  if (hasBlockingAssistantReply || replyState.hasHumanReply) {
    return {
      shouldSkip: true,
      reusableAssistantReplyTs: null,
    };
  }

  return {
    shouldSkip: false,
    reusableAssistantReplyTs: null,
  };
}
