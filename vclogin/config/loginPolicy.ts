/**
 * Copyright 2024 Software Engineering for Business Information Systems (sebis) <matthes@tum.de> .
 * SPDX-License-Identifier: MIT
 */

import { promises as fs } from "fs";

export const getConfiguredLoginPolicy = async () => {
  try {
    const file = await fs.readFile(process.env.LOGIN_POLICY as string, "utf8");
    return JSON.parse(file);
  } catch (error) {
    console.error("Failed to read login policy:", error);
    return undefined;
  }
};
