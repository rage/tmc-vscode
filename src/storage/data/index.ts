// All types that are stored in VSCode's storage should be defined under here
// to ensure they're versioned correctly.

import * as v0 from "./data_v0";
import * as v1 from "./data_v1";
import * as v2 from "./data_v2";

// export all versions
export { v0, v1, v2 };
// export everything from latest version
export * from "./data_v2";
