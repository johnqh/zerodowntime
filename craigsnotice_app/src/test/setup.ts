import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Testing Library only auto-cleans when vitest runs with `globals: true`.
// Without this, each test renders into the previous test's DOM and queries
// match multiple elements.
afterEach(cleanup);
