// All types that are stored in VSCode's storage should be defined under here
// to ensure they're versioned correctly.
import * as v0 from "./data_v0";
import * as v1 from "./data_v1";
import * as v2 from "./data_v2";
import * as v3 from "./data_v3";

// export all versions
export { v0, v1, v2, v3 };
// export everything from the latest version this one writes; v3 is only read
export * from "./data_v2";
