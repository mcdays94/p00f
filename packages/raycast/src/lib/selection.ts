import { type CreatedClip, type HttpLike } from "@p00f/core";
import { createTextPoof, type RaycastClipboardLike } from "./create-service";
import type { CreateDefaults } from "./preferences";

export interface SelectionDeps {
  http: HttpLike;
  clipboard: RaycastClipboardLike;
  getSelectedText(): Promise<string>;
}

export async function createSelectedTextPoof(
  deps: SelectionDeps,
  defaults: CreateDefaults,
): Promise<CreatedClip> {
  let selectedText: string;
  try {
    selectedText = await deps.getSelectedText();
  } catch {
    throw new Error("No selected text to poof");
  }
  if (!selectedText.trim()) throw new Error("No selected text to poof");
  return createTextPoof(deps, { text: selectedText, ...defaults });
}
