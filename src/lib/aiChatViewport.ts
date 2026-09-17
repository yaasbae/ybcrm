export type AiChatViewport = { top: number; height: number; keyboard: boolean };

export function calculateAiChatViewport(
  viewportHeight: number,
  viewportOffsetTop: number,
  windowHeight: number,
  appHeaderHeight = 56,
): AiChatViewport {
  const top = Math.max(appHeaderHeight, viewportOffsetTop);
  const obscuredHeader = Math.max(0, appHeaderHeight - viewportOffsetTop);
  return {
    top,
    height: Math.max(320, viewportHeight - obscuredHeader),
    keyboard: viewportHeight < windowHeight * 0.75,
  };
}
