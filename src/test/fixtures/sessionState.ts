import { SessionStateV1 } from "../../migrate/migrateSessionState";

const v2_0_0: SessionStateV1 = {
    extensionVersion: "2.0.0",
    oldDataPath: { path: "/path/to/exercises", timestamp: 1234 },
};

export { v2_0_0 };
