export const DETAIL_TOGGLE_ACTION_ID = "incident_toggle_detail";
export const FOLLOW_UP_ACTION_PREFIX = "incident_follow_up";

function buildToggleButton(expanded) {
  return {
    type: "button",
    action_id: DETAIL_TOGGLE_ACTION_ID,
    text: {
      type: "plain_text",
      text: expanded ? "요약 보기" : "상세 보기",
    },
    value: expanded ? "collapse" : "expand",
    ...(expanded ? {} : { style: "primary" }),
  };
}

function buildFollowUpButtons() {
  return [
    {
      type: "button",
      action_id: `${FOLLOW_UP_ACTION_PREFIX}_db`,
      text: {
        type: "plain_text",
        text: "DB 확인",
      },
      value: "db",
    },
    {
      type: "button",
      action_id: `${FOLLOW_UP_ACTION_PREFIX}_cache`,
      text: {
        type: "plain_text",
        text: "캐시/Redis 확인",
      },
      value: "cache",
    },
    {
      type: "button",
      action_id: `${FOLLOW_UP_ACTION_PREFIX}_external`,
      text: {
        type: "plain_text",
        text: "외부 API 확인",
      },
      value: "external",
    },
  ];
}

export function buildToggleBlocks(contentBlocks, options = {}) {
  const { expanded = false } = options;

  return [
    ...contentBlocks,
    {
      type: "actions",
      block_id: `incident-toggle-${expanded ? "expanded" : "summary"}`,
      elements: expanded
        ? [ buildToggleButton(expanded), ...buildFollowUpButtons() ]
        : [ buildToggleButton(expanded) ],
    },
  ];
}
