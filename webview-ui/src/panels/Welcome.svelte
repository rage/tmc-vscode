<script lang="ts">
  import Button from "../components/Button.svelte"
  import { releaseNotes } from "../generated/releaseNotes"
  import type { WelcomePanel } from "../shared/shared"
  import { pasteServiceName } from "../shared/shared"
  import { focusOnMount } from "../utilities/a11y.svelte"
  import { vscode } from "../utilities/vscode"

  interface Props {
    panel: WelcomePanel
  }

  let { panel }: Props = $props()

  function openInBrowser(url: string) {
    vscode.postMessage({ type: "openLinkInBrowser", url })
  }
  function openMyCourses() {
    vscode.postMessage({ type: "openMyCourses" })
  }
</script>

<div class="welcome">
  <header>
    <h1 class="page-title" tabindex="-1" {@attach focusOnMount}>
      Welcome to TestMyCode{panel.version ? ` ${panel.version}` : ""}!
    </h1>
  </header>

  <div class="welcome-body">
    <div class="main">
      <section class="info">
        <p>
          This extension provides <a href="https://tmc.mooc.fi">TestMyCode</a> integration for Visual
          Studio Code.
        </p>
        <p>
          TestMyCode is a programming assignment evaluator developed and maintained by Agile
          Education Research group (RAGE) at University of Helsinki.
        </p>
        <p>
          Log in with your <a href="https://courses.mooc.fi">courses.mooc.fi</a> account. The same
          account works for courses on both courses.mooc.fi and
          <a href="https://tmc.mooc.fi">tmc.mooc.fi</a>. For setting up the programming environment,
          always refer to your course's own instructions.
        </p>
        {#if !panel.loggedIn}
          <p>
            To get started, choose Log In in the TestMyCode view, or run "TestMyCode: Log In" from
            the Command Palette.
          </p>
        {/if}
        <div class="actions cta">
          {#if panel.loggedIn}
            <Button onclick={openMyCourses}>My Courses</Button>
          {/if}
          <Button
            secondary
            onclick={() =>
              openInBrowser("https://www.mooc.fi/en/installation/vscode#start-programming")}
          >
            Read instructions
          </Button>
        </div>
      </section>

      <section>
        <h2>What's new in TestMyCode?</h2>
        <p>
          Here is a short overview of the latest features. To see the full change history, please
          refer to the
          <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">CHANGELOG</a>.
        </p>

        {#each releaseNotes as note (note.version)}
          <h3>{note.date ? `${note.version} - ${note.date}` : note.version}</h3>
          <ul>
            {#each note.entries as entry (entry)}
              <li>{entry}</li>
            {/each}
          </ul>
        {/each}
      </section>

      <section>
        <h2>Data collected by the extension</h2>
        <p>
          The extension does not have trackers or telemetry. It's open source, and anyone can verify
          what it does. See:
          <a href="https://github.com/rage/tmc-vscode">https://github.com/rage/tmc-vscode</a>.
        </p>
        <p>
          If you choose to submit your answer to a programming exercise to be graded to our server,
          the extension will send us the folder of that specific exercise. This folder contains only
          your solution to the exercise, and no other files are sent. This information will also
          include the language the server should use for error messages. The error message language
          is currently your computer's locale. We may check the answers you submit for plagiarism,
          and we may use the IP address of the computer that submitted the exercise for blocking
          spam and preventing abuse.
        </p>
        <p>
          The same applies if you choose to submit your answer to {pasteServiceName("tmc")} or
          {pasteServiceName("mooc")} for sharing your solution to other students.
        </p>
        <p>
          When you interact with our server, e.g. log in, download, or submit exercises, we will
          send the version of this plugin in the requests. This is used for blocking outdated and
          potentially misbehaving plugin versions.
        </p>
      </section>
    </div>

    <aside class="sidebar">
      <div class="sidebar-group">
        <h2>Help</h2>
        <ul>
          <li><a href="https://www.mooc.fi/en/installation/vscode">Installing environment</a></li>
          <li>
            <a href="https://www.mooc.fi/en/installation/vscode#start-programming"
              >Start programming</a
            >
          </li>
          <li><a href="https://github.com/rage/tmc-vscode/issues">Questions & Issues</a></li>
          <li><a href="https://github.com/rage/tmc-vscode/blob/master/docs/FAQ.md">FAQ</a></li>
        </ul>
      </div>
      <div class="sidebar-group">
        <h2>Resources</h2>
        <ul>
          <li>
            <a href="https://www.helsinki.fi/en/researchgroups/data-driven-education">Website</a>
          </li>
          <li>
            <a href="https://github.com/rage/tmc-vscode/blob/master/CHANGELOG.md">Changelog</a>
          </li>
          <li>
            <a href="https://marketplace.visualstudio.com/publishers/moocfi">Marketplace</a>
          </li>
          <li><a href="https://github.com/rage/tmc-vscode">GitHub</a></li>
          <li>
            <a href="https://github.com/rage/tmc-vscode/blob/master/docs/insider.md">Insiders</a>
          </li>
          <li><a href="https://github.com/rage/tmc-vscode/blob/master/LICENSE">License</a></li>
          <li>
            <a href="https://github.com/rage/tmc-vscode/blob/master/CONTRIBUTING.md">Contributing</a
            >
          </li>
        </ul>
      </div>
      <div class="sidebar-group">
        <h2>TestMyCode Resources</h2>
        <ul>
          <li><a href="http://mooc.fi/">mooc.fi</a></li>
          <li><a href="https://tmc.mooc.fi">tmc.mooc.fi</a></li>
          <li><a href="https://github.com/rage/tmc-langs-rust">TMC-langs Rust</a></li>
        </ul>
      </div>
    </aside>
  </div>
</div>

<style>
  .welcome-body {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--tmc-space-6);
  }
  .main {
    min-width: 0;
  }
  .cta {
    margin: var(--tmc-space-4) 0;
  }
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: var(--tmc-space-4);
  }
  .sidebar-group h2 {
    margin-bottom: var(--tmc-space-2);
  }
  .sidebar-group ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .sidebar-group li {
    margin: var(--tmc-space-1) 0;
  }

  /* Two-column layout once the panel is wide enough, e.g. opened as an editor tab. */
  @media (min-width: 720px) {
    .welcome-body {
      grid-template-columns: minmax(0, 3fr) minmax(192px, 1fr);
    }
  }
</style>
