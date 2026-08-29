/**
 * WO-138 — author identity is the only input to horizontal message alignment.
 * Each message row applies this independently so a short message cannot inherit
 * the starting edge of a wider sibling in the same visual group.
 */
export function messageRowAlignment(isMine: boolean): "justify-end" | "justify-start" {
  return isMine ? "justify-end" : "justify-start";
}