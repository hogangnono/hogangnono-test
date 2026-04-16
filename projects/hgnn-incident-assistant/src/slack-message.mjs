function flattenRichTextElements(elements = [], values = []) {
  for (const element of elements) {
    if (typeof element?.text === "string") {
      values.push(element.text);
    }

    if (typeof element?.url === "string") {
      values.push(element.url);
    }

    if (Array.isArray(element?.elements)) {
      flattenRichTextElements(element.elements, values);
    }
  }

  return values;
}

function flattenBlockText(blocks = []) {
  const values = [];

  for (const block of blocks) {
    if (typeof block?.text?.text === "string") {
      values.push(block.text.text);
    }

    for (const field of block?.fields ?? []) {
      if (typeof field?.text === "string") {
        values.push(field.text);
      }
    }

    if (typeof block?.alt_text === "string") {
      values.push(block.alt_text);
    }

    flattenRichTextElements(block?.elements ?? [], values);
  }

  return values.join("\n").trim();
}

function flattenAttachmentText(attachments = []) {
  const values = [];

  for (const attachment of attachments) {
    if (typeof attachment?.pretext === "string") {
      values.push(attachment.pretext);
    }

    if (typeof attachment?.title === "string") {
      values.push(attachment.title);
    }

    if (typeof attachment?.text === "string") {
      values.push(attachment.text);
    }

    if (typeof attachment?.fallback === "string") {
      values.push(attachment.fallback);
    }

    for (const field of attachment?.fields ?? []) {
      if (typeof field?.title === "string") {
        values.push(field.title);
      }

      if (typeof field?.value === "string") {
        values.push(field.value);
      }
    }

    if (typeof attachment?.footer === "string") {
      values.push(attachment.footer);
    }

    if (Array.isArray(attachment?.blocks)) {
      const attachmentBlockText = flattenBlockText(attachment.blocks);
      if (attachmentBlockText) {
        values.push(attachmentBlockText);
      }
    }
  }

  return values.join("\n").trim();
}

function flattenFileText(files = []) {
  const values = [];

  for (const file of files) {
    if (typeof file?.title === "string") {
      values.push(file.title);
    }

    if (typeof file?.name === "string") {
      values.push(file.name);
    }

    if (typeof file?.preview_plain_text === "string") {
      values.push(file.preview_plain_text);
      continue;
    }

    if (typeof file?.plain_text === "string") {
      values.push(file.plain_text);
      continue;
    }

    if (typeof file?.preview === "string") {
      values.push(file.preview);
    }
  }

  return values.join("\n").trim();
}

export function buildMessageText(message) {
  return [
    message.text ?? "",
    flattenBlockText(message.blocks),
    flattenAttachmentText(message.attachments),
    flattenFileText(message.files),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function normalizeSlackMessage(message, channel, fallbackSubtype = null) {
  return {
    channel,
    ts: message.ts,
    threadTs: message.thread_ts ?? message.ts,
    text: buildMessageText(message),
    subtype: message.subtype ?? fallbackSubtype,
    botProfileName: message.bot_profile?.name ?? message.username ?? null,
    user: message.user ?? null,
    botId: message.bot_id ?? null,
  };
}

export function normalizeMessageEvent(event) {
  if (event.subtype === "message_changed" && event.message) {
    return normalizeSlackMessage(event.message, event.channel, event.subtype);
  }

  return normalizeSlackMessage(event, event.channel);
}

export function isSameSlackSource(message, rootMessage, expectedSourceName = null) {
  if (!message || !rootMessage) {
    return false;
  }

  if (message.ts === rootMessage.ts) {
    return true;
  }

  if (rootMessage.botId && message.botId && rootMessage.botId === message.botId) {
    return true;
  }

  if (rootMessage.botProfileName && message.botProfileName && rootMessage.botProfileName === message.botProfileName) {
    return true;
  }

  if (expectedSourceName && message.botProfileName === expectedSourceName) {
    return true;
  }

  return false;
}

export function selectSourceThreadMessages(messages = [], rootMessage, expectedSourceName = null) {
  return messages.filter((message) => isSameSlackSource(message, rootMessage, expectedSourceName));
}

export function buildConversationText(messages = []) {
  const uniqueTexts = [ ...new Set(
    messages
      .map((message) => typeof message === "string" ? message : buildMessageText(message))
      .map((value) => value.trim())
      .filter(Boolean),
  ) ];

  return uniqueTexts.join("\n\n").trim();
}
