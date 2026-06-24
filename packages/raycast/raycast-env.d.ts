/// <reference types="@raycast/api">

/* 🚧 🚧 🚧
 * This file is auto-generated from the extension's manifest.
 * Do not modify manually. Instead, update the `package.json` file.
 * 🚧 🚧 🚧 */

/* eslint-disable @typescript-eslint/ban-types */

type ExtensionPreferences = {
  /** p00f Base URL - Hosted p00f service or a self-hosted base URL. */
  "base": string,
  /** Default TTL - Default time-to-live for quick Poofs. */
  "defaultTtl": "60000" | "300000" | "3600000" | "86400000" | "604800000" | "2592000000",
  /** Default Reveal Budget - Default number of Reveals before a Poof burns. */
  "defaultReveals": "1" | "3" | "10" | "-1",
  /** Reveal-Anchored TTL - Start the timer on first Reveal by default. */
  "defaultRevealAnchored": boolean,
  /** Viewer Delete - Let the viewer delete the Poof by default. */
  "defaultAllowViewerDelete": boolean,
  /** Reveal Captcha - Require recipients to solve a browser captcha before Reveal by default. */
  "defaultRequireTurnstile": boolean,
  /** Open After Create - Open newly created Poof links in the browser. */
  "openInBrowserAfterCreate": boolean,
  /** Paste After Create - Paste the created Link into the frontmost app after copying it. */
  "pasteAfterCreate": boolean
}

/** Preferences accessible in all the extension's commands */
declare type Preferences = ExtensionPreferences

declare namespace Preferences {
  /** Preferences accessible in the `create-poof` command */
  export type CreatePoof = ExtensionPreferences & {}
  /** Preferences accessible in the `poof-selection` command */
  export type PoofSelection = ExtensionPreferences & {}
}

declare namespace Arguments {
  /** Arguments passed to the `create-poof` command */
  export type CreatePoof = {}
  /** Arguments passed to the `poof-selection` command */
  export type PoofSelection = {}
}

