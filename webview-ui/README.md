Contains the "frontend" of the extension. Consists of panels, each of which has an associated `Panel` type. For example, the state of the "My Courses" webview is stored in a `MyCoursesPanel` prop. The panel types are all in the `shared` directory in the repository root, so they can be shared between the "frontend" and "backend".

## About panels

Each panel requests the data it needs to display with a message fired in an `onMount` hook, for example:

```ts
    onMount(() => {
        vscode.postMessage({
            type: "requestMyCoursesData",
            sourcePanel: panel,
        });
    });
```

they then receive this data (and other messages) using an `addMessageListener` helper function:

```ts
    addMessageListener(panel, (message) => {
        switch (message.type) {
            case "setMyCourses": {
                panel.courses = message.courses;
                savePanelState(panel);
                break;
            }
            case "setTmcDataPath": {
                panel.tmcDataPath = message.tmcDataPath;
                savePanelState(panel);
                break;
            }
            case "setTmcDataSize": {
                panel.tmcDataSize = message.tmcDataSize;
                savePanelState(panel);
                break;
            }
            case "selectedOrganization": {
                selectedOrganizationSlug.set(message.slug);
                vscode.postMessage({
                    type: "selectCourse",
                    sourcePanel: panel,
                    slug: message.slug,
                });
                break;
            }
            case "selectedCourse": {
                vscode.postMessage({
                    type: "addCourse",
                    organizationSlug: message.organizationSlug,
                    courseId: message.courseId,
                    requestingPanel: panel,
                });
                // todo: only close side panel on success
                vscode.postMessage({
                    type: "closeSidePanel",
                });
                break;
            }
            default:
                assertUnreachable(message);
        }
    });

```

When the panel state is changed, it can be saved with the `savePanelState` function, so that the state can be loaded when reopening VSCode and such.

## About messages


