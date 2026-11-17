<script lang="ts">
  import { untrack } from "svelte"

  import type { LoginAction, LoginFailure, LoginPanel, LoginView } from "../../../shared/lib"
  import type { BarAction } from "../components/ActionBar.svelte"
  import ActionBar from "../components/ActionBar.svelte"
  import Button from "../components/Button.svelte"
  import PanelHeader from "../components/PanelHeader.svelte"
  import Spinner from "../components/Spinner.svelte"
  import StatusBanner from "../components/StatusBanner.svelte"
  import { announce } from "../utilities/a11y.svelte"
  import { addMessageListener, createRequester, HOST_STATE_TIMEOUT_MS } from "../utilities/script"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: LoginPanel
  }

  /** The courses.mooc.fi device-flow login, which the host runs and reports here. */
  let { panel }: Props = $props()

  const FAILURE_TITLES: Record<LoginFailure, string> = {
    denied: "Login denied",
    expired: "Login code expired",
    unreachable: "Connection failed",
    serverError: "The server ran into a problem",
    other: "Login failed",
  }

  // What to do next, where the host's sentence does not say it.
  const FAILURE_HINTS: Partial<Record<LoginFailure, string>> = {
    denied: "If you meant to approve it, try again for a new code.",
    expired: "Try again for a new code.",
  }

  let view = $state.raw<LoginView>({ phase: "requestingCode" })
  let copyState = $state<"idle" | "copied" | "failed">("idle")
  let now = $state(Date.now())

  const request = createRequester()

  const listeningPanel = untrack(() => panel)
  addMessageListener(listeningPanel, (message) => {
    view = message.view
    copyState = "idle"
    announce(announcement(message.view))
  })

  function announcement(next: LoginView): string {
    switch (next.phase) {
      case "requestingCode":
        return "Getting a login code"
      case "waiting":
        return `Your login code is ${next.userCode}`
      case "failed":
        return FAILURE_TITLES[next.failure]
      case "loggedIn":
        return "Logged in"
    }
  }

  // Minutes are all the expiry shows, so a coarse tick keeps it current.
  $effect(() => {
    if (view.phase !== "waiting") {
      return
    }
    now = Date.now()
    const timer = setInterval(() => {
      now = Date.now()
    }, 15_000)
    return () => clearInterval(timer)
  })

  // The code stays on screen for minutes, so the copy outcome beside it expires.
  $effect(() => {
    if (copyState === "idle") {
      return
    }
    const timer = setTimeout(() => {
      copyState = "idle"
    }, 2000)
    return () => clearTimeout(timer)
  })

  function expiry(expiresAt: string): string {
    const minutes = Math.ceil((Date.parse(expiresAt) - now) / 60_000)
    if (minutes <= 0) {
      return "The code has expired."
    }
    return `The code expires in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`
  }

  function run(action: LoginAction) {
    vscode.postMessage({
      type: "loginAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action,
    })
  }

  async function copyCode(userCode: string) {
    const outcome = await request(
      "copyToClipboard",
      { sourcePanel: { id: panel.id, type: panel.type }, text: userCode },
      { timeoutMs: HOST_STATE_TIMEOUT_MS },
    )
    copyState = outcome.ok ? "copied" : "failed"
    announce(outcome.ok ? "Login code copied" : "Could not copy the login code")
  }

  const cancel: BarAction = { label: "Cancel", onclick: () => run("cancel") }

  // Only a failure the student did not cause in the browser has details to show.
  const showDetails: BarAction | undefined = $derived.by(() => {
    const detailsId = view.phase === "failed" ? view.error.detailsId : undefined
    return detailsId === undefined
      ? undefined
      : {
          label: "Show Details",
          onclick: () => void vscode.postMessage({ type: "showErrorDetails", detailsId }),
        }
  })
</script>

<div class="login">
  <PanelHeader title="Log In" />

  {#if view.phase === "requestingCode"}
    <p><Spinner label="Getting a login code…" /></p>
    <ActionBar secondary={[cancel]} />
  {:else if view.phase === "waiting"}
    {@const userCode = view.userCode}
    <p class="muted code-label">Your login code</p>
    <div class="code-row">
      <p class="code">{userCode}</p>
      <Button secondary icon="copy" onclick={() => void copyCode(userCode)}>
        {copyState === "copied" ? "Copied" : "Copy"}
      </Button>
    </div>
    {#if copyState === "failed"}
      <p class="muted">Could not copy the code. Select it and copy it by hand.</p>
    {/if}
    <ActionBar
      primary={{ label: "Open MOOC.fi", onclick: () => run("openVerificationPage") }}
      secondary={[cancel]}
    />
    <p class="waiting">
      <Spinner label="Waiting for you to approve the login in your browser." />
      <span class="muted">{expiry(view.expiresAt)}</span>
    </p>
    <p class="muted">
      Check that the page shows the same code before you approve. In another browser, go to
      <span class="url">{view.verificationUrl}</span> and enter the code there.
    </p>
  {:else if view.phase === "failed"}
    {@const hint = FAILURE_HINTS[view.failure]}
    <StatusBanner tone="failed" title={FAILURE_TITLES[view.failure]}>
      <p>{view.error.message}</p>
      {#if hint}<p>{hint}</p>{/if}
    </StatusBanner>
    <ActionBar
      primary={{ label: "Try Again", onclick: () => run("tryAgain") }}
      secondary={showDetails ? [showDetails] : []}
    />
  {:else}
    <StatusBanner tone="passed" title="Logged in">
      <p>You are logged in with your MOOC.fi account.</p>
    </StatusBanner>
  {/if}
</div>

<style>
  .login {
    max-width: var(--tmc-content-max-width, 720px);
  }
  .code-label {
    margin: var(--tmc-space-4) 0 var(--tmc-space-1);
  }
  .code-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-3);
  }
  .code {
    margin: 0;
    font-family: var(--tmc-font-mono);
    font-size: 2em;
    font-weight: 600;
    letter-spacing: 0.1em;
    user-select: all;
    overflow-wrap: anywhere;
  }
  .waiting {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--tmc-space-1) var(--tmc-space-3);
  }
  .url {
    font-family: var(--tmc-font-mono);
    user-select: all;
    overflow-wrap: anywhere;
  }
</style>
