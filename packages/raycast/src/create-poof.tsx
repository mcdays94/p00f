import {
  Action,
  ActionPanel,
  Clipboard,
  Form,
  Toast,
  getPreferenceValues,
  open,
  showToast,
} from "@raycast/api";
import { createTextPoof } from "./lib/create-service";
import {
  createDefaultsFromPreferences,
  type PoofPreferences,
} from "./lib/preferences";

interface FormValues {
  text: string;
}

const http = (input: string, init?: RequestInit) => fetch(input, init);

export default function Command() {
  const preferences = getPreferenceValues<PoofPreferences>();

  async function onSubmit(values: FormValues) {
    const text = values.text.trim();
    if (!text) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Nothing to poof",
        message: "Enter text first.",
      });
      return;
    }

    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Creating Poof",
    });
    try {
      const created = await createTextPoof(
        { http, clipboard: Clipboard },
        {
          text,
          ...createDefaultsFromPreferences(preferences),
        },
      );
      toast.style = Toast.Style.Success;
      toast.title = preferences.pasteAfterCreate
        ? "Poof link pasted"
        : "Poof link copied";
      toast.message =
        "Owner token available only in logs for this minimal tracer.";
      if (preferences.openInBrowserAfterCreate) await open(created.link);
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = "Could not create Poof";
      toast.message = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Poof" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextArea
        id="text"
        title="Text"
        placeholder="Paste something that should not stick around."
      />
    </Form>
  );
}
