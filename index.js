import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import GarminConnect from "garmin-connect";

const { GarminConnect: GC } = GarminConnect;

const TOKEN_PATH = join(homedir(), ".garmin-token.json");
let client = null;

async function getClient() {
  if (client) return client;
  client = new GC({
    username: process.env.GARMIN_EMAIL || "",
    password: process.env.GARMIN_PASSWORD || "",
  });

  // Try loading saved token first
  if (existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
      await client.loadToken(token);
      return client;
    } catch {}
  }

  // Fall back to login
  const email = process.env.GARMIN_EMAIL;
  const password = process.env.GARMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("GARMIN_EMAIL and GARMIN_PASSWORD required (no saved token found)");
  }
  await client.login();

  // Save token for next time
  const token = await client.exportToken();
  writeFileSync(TOKEN_PATH, JSON.stringify(token));

  return client;
}

function formatDate(date) {
  return date.toISOString().split("T")[0];
}

const server = new McpServer({
  name: "garmin-health-mcp",
  version: "0.1.0",
});

// Get today's heart rate
server.tool(
  "get_heart_rate",
  "Get heart rate data for a given date. Returns resting HR, max HR, min HR, and time-series data. Use this to understand the user's cardiovascular state.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();
    const hr = await gc.getHeartRate(d);
    // Extract latest heart rate from time-series data
    const heartRateValues = hr?.heartRateValues || [];
    let latestHR = null;
    let latestTimestamp = null;
    for (const entry of heartRateValues) {
      if (entry && entry[1] > 0) {
        latestTimestamp = entry[0];
        latestHR = entry[1];
      }
    }
    const summary = {
      date: formatDate(d),
      restingHeartRate: hr?.restingHeartRate,
      maxHeartRate: hr?.maxHeartRate,
      minHeartRate: hr?.minHeartRate,
      lastSevenDaysAvgRestingHeartRate: hr?.lastSevenDaysAvgRestingHeartRate,
      latestHeartRate: latestHR,
      latestTimestamp: latestTimestamp ? new Date(latestTimestamp).toISOString() : null,
      timeSeriesCount: heartRateValues.length,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// Get sleep data
server.tool(
  "get_sleep",
  "Get sleep data for a given date. Returns sleep duration, deep/light/REM sleep, sleep score, and wake times. Use this to know if the user slept well.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();
    const sleep = await gc.getSleepData(d);
    const summary = {
      date: formatDate(d),
      sleepTimeSeconds: sleep?.dailySleepDTO?.sleepTimeSeconds,
      sleepStartTimestampLocal: sleep?.dailySleepDTO?.sleepStartTimestampLocal,
      sleepEndTimestampLocal: sleep?.dailySleepDTO?.sleepEndTimestampLocal,
      deepSleepSeconds: sleep?.dailySleepDTO?.deepSleepSeconds,
      lightSleepSeconds: sleep?.dailySleepDTO?.lightSleepSeconds,
      remSleepSeconds: sleep?.dailySleepDTO?.remSleepSeconds,
      awakeSleepSeconds: sleep?.dailySleepDTO?.awakeSleepSeconds,
      averageSpO2Value: sleep?.dailySleepDTO?.averageSpO2Value,
      overallScore: sleep?.dailySleepDTO?.sleepScores?.overallScore,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// Get stress data
server.tool(
  "get_stress",
  "Get stress level data for a given date. Returns average, max, and time in stress/rest/activity. Use this to gauge the user's mental load.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();
    const stress = await gc.getStress(d);
    const summary = {
      date: formatDate(d),
      overallStressLevel: stress?.overallStressLevel,
      restStressDuration: stress?.restStressDuration,
      activityStressDuration: stress?.activityStressDuration,
      lowStressDuration: stress?.lowStressDuration,
      mediumStressDuration: stress?.mediumStressDuration,
      highStressDuration: stress?.highStressDuration,
      maxStressLevel: stress?.maxStressLevel,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// Get body battery
server.tool(
  "get_body_battery",
  "Get Body Battery data for a given date. Body Battery represents energy levels (0-100). Use this to know if the user has energy or is drained.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();
    const bb = await gc.getBodyBattery(d);
    const events = (bb || []).map((e) => ({
      timestamp: e.startTimestampLocal,
      charged: e.chargedValue,
      drained: e.drainedValue,
      bodyBatteryLevel: e.bodyBatteryLevel,
    }));
    const latest = events.length > 0 ? events[events.length - 1] : null;
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ date: formatDate(d), latest, eventCount: events.length }, null, 2),
      }],
    };
  }
);

// Get steps
server.tool(
  "get_steps",
  "Get step count for a given date. Use this to know how active the user has been.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();
    const steps = await gc.getSteps(d);
    const summary = {
      date: formatDate(d),
      totalSteps: steps?.totalSteps,
      totalDistance: steps?.totalDistance,
      stepGoal: steps?.stepGoal,
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

// Get user summary (all-in-one)
server.tool(
  "get_health_summary",
  "Get a comprehensive health summary for a given date. Includes heart rate, sleep, stress, body battery, and steps. This is the best tool to get an overall picture of the user's physical state.",
  { date: z.string().optional().describe("Date in YYYY-MM-DD format. Defaults to today.") },
  async ({ date }) => {
    const gc = await getClient();
    const d = date ? new Date(date) : new Date();

    const [hr, sleep, stress, steps] = await Promise.all([
      gc.getHeartRate(d).catch(() => null),
      gc.getSleepData(d).catch(() => null),
      gc.getStress(d).catch(() => null),
      gc.getSteps(d).catch(() => null),
    ]);

    const summary = {
      date: formatDate(d),
      heartRate: {
        resting: hr?.restingHeartRate,
        max: hr?.maxHeartRate,
        min: hr?.minHeartRate,
      },
      sleep: {
        durationHours: sleep?.dailySleepDTO?.sleepTimeSeconds
          ? (sleep.dailySleepDTO.sleepTimeSeconds / 3600).toFixed(1)
          : null,
        overallScore: sleep?.dailySleepDTO?.sleepScores?.overallScore,
        deepSleepMinutes: sleep?.dailySleepDTO?.deepSleepSeconds
          ? Math.round(sleep.dailySleepDTO.deepSleepSeconds / 60)
          : null,
      },
      stress: {
        overall: stress?.overallStressLevel,
        highStressMinutes: stress?.highStressDuration
          ? Math.round(stress.highStressDuration / 60)
          : null,
      },
      steps: {
        total: steps?.totalSteps,
        goal: steps?.stepGoal,
      },
    };
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
