import {
  Clipboard,
  Toast,
  getPreferenceValues,
  getSelectedText,
  showToast,
} from "@raycast/api";
import {
  createDefaultsFromPreferences,
  type PoofPreferences,
} from "./lib/preferences";
import { createSelectedTextPoof } from "./lib/selection";

const http = (input: string, init?: RequestInit) => fetch(input, init);

export default async function Command() {
  const preferences = getPreferenceValues<PoofPreferences>();
  const toast = await showToast({
    style: Toast.Style.Animated,
    title: "Creating Poof",
  });
  try {
    await createSelectedTextPoof(
      { http, clipboard: Clipboard, getSelectedText },
      createDefaultsFromPreferences(preferences),
    );
    toast.style = Toast.Style.Success;
    toast.title = preferences.pasteAfterCreate
      ? "Poof link pasted"
      : "Poof link copied";
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title =
      error instanceof Error ? error.message : "Could not create Poof";
  }
}
