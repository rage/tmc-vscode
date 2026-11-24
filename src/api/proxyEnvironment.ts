/**
 * The proxy variables to start the CLI with, from VS Code's `http.proxy` and `http.noProxy`.
 * A variable the environment already has wins, and so does the student's own setup over ours.
 */
export function proxyEnvironment(
  settings: { proxy: string; noProxy: string[] } | undefined,
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  if (!settings) {
    return {}
  }
  const isSet = (name: string): boolean =>
    Boolean(environment[name] ?? environment[name.toLowerCase()])
  const variables: Record<string, string> = {}
  if (settings.proxy !== "") {
    for (const name of ["HTTPS_PROXY", "HTTP_PROXY"]) {
      if (!isSet(name)) {
        variables[name] = settings.proxy
      }
    }
  }
  if (settings.noProxy.length > 0 && !isSet("NO_PROXY")) {
    variables["NO_PROXY"] = settings.noProxy.join(",")
  }
  return variables
}
