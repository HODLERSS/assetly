import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";
configure({ asyncUtilTimeout: 4000 });
afterEach(cleanup);   // no vitest globals here, so RTL can't register its own cleanup
