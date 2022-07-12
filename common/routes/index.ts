import { Area, Gem } from "../types";
import {
  EvaluateQuest,
  EvaluateQuestText,
  QuestAction,
  QuestTextAction,
  RewardStep,
} from "./quest";

import { areas, killWaypoints } from "../../common/data";

export type ParsedAction = string[];
export type ParsedActionStep = (string | ParsedAction)[];

export interface ActionStep {
  type: "action_step";
  parts: (string | Action)[];
}

export type Step = ActionStep | RewardStep;
export type Route = Step[];

export interface RouteLookup {
  towns: Record<Area["act"], Area["id"]>;
  buildData: BuildData | null;
}

export interface RouteState {
  implicitWaypoints: Set<Area["id"]>;
  explicitWaypoints: Set<Area["id"]>;
  usedWaypoints: Set<Area["id"]>;
  craftingAreas: Set<Area["id"]>;
  currentAreaId: Area["id"];
  lastTownAreaId: Area["id"];
  portalAreaId: Area["id"] | null;
  acquiredGems: Set<Gem["id"]>;
}

function parseStep(text: string) {
  const regex = /(\s*#.*)|([^{#]+)|\{(.+?)\}/g;

  let parts: ParsedActionStep = [];

  const matches = text.matchAll(regex);
  for (const match of matches) {
    const commentMatch = match[1];
    if (commentMatch) continue;

    const textMatch = match[2];
    if (textMatch) {
      parts.push(textMatch);
    }

    const actionMatch = match[3];
    if (actionMatch) {
      const split = actionMatch.split("|");
      parts.push(split);
    }
  }

  return parts;
}

interface KillAction {
  type: "kill";
  value: string;
}

function EvaluateKill(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;
  const bossName = action[1];

  // TODO data incomplete
  // const currentArea = state.areas[state.currentAreaId];
  // if (!currentArea.bosses.some((x) => x.name == bossName)) return false;

  const waypointUnlocks = killWaypoints[bossName];
  if (waypointUnlocks) {
    for (const waypointUnlock of waypointUnlocks) {
      state.implicitWaypoints.add(waypointUnlock);
    }
  }

  return {
    action: {
      type: "kill",
      value: bossName,
    },
  };
}

interface ArenaAction {
  type: "arena";
  value: string;
}

function EvaluateArena(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;
  return {
    action: {
      type: "arena",
      value: action[1],
    },
  };
}

interface AreaAction {
  type: "area";
  areaId: Area["id"];
}

function EvaluateArea(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;

  const area = areas[action[1]];
  if (!area) return ERROR_MISSING_AREA;

  return {
    action: {
      type: "area",
      areaId: area.id,
    },
  };
}

interface EnterAction {
  type: "enter";
  areaId: Area["id"];
}

function EvaluateEnter(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;

  const area = areas[action[1]];
  if (!area) return ERROR_MISSING_AREA;
  if (!area.connection_ids.some((x) => x == state.currentAreaId))
    return "not connected to current area";

  if (area.is_town_area) {
    state.lastTownAreaId = area.id;
    if (area.has_waypoint) state.implicitWaypoints.add(area.id);
  }

  state.currentAreaId = area.id;
  return {
    action: {
      type: "enter",
      areaId: area.id,
    },
  };
}

interface TownAction {
  type: "town";
}

function EvaluateTown(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;

  const area = areas[state.currentAreaId];
  state.currentAreaId = state.lastTownAreaId;
  return {
    action: {
      type: "town",
    },
  };
}

interface WaypointAction {
  type: "waypoint";
  areaId: Area["id"] | null;
}

function EvaluateWaypoint(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  {
    if (action.length != 1 && action.length != 2) return ERROR_INVALID_FORMAT;

    let areaId: Area["id"] | null = null;
    if (action.length == 2) {
      const area = areas[action[1]];
      if (!area) return ERROR_MISSING_AREA;
      if (
        !state.implicitWaypoints.has(area.id) &&
        !state.explicitWaypoints.has(area.id)
      )
        return "missing target waypoint";

      const currentArea = areas[state.currentAreaId];
      if (!currentArea.has_waypoint) return ERROR_AREA_NO_WAYPOINT;

      state.implicitWaypoints.add(currentArea.id);
      state.usedWaypoints.add(area.id);

      state.currentAreaId = area.id;
      areaId = area.id;
    }

    return {
      action: {
        type: "waypoint",
        areaId: areaId,
      },
    };
  }
}

interface GetWaypointAction {
  type: "get_waypoint";
}

function EvaluateGetWaypoint(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;

  const area = areas[state.currentAreaId];
  if (!area) return ERROR_MISSING_AREA;
  if (!area.has_waypoint) return ERROR_AREA_NO_WAYPOINT;
  if (state.implicitWaypoints.has(area.id)) return "waypoint already acquired";

  state.explicitWaypoints.add(area.id);

  return {
    action: {
      type: "get_waypoint",
    },
  };
}

interface SetPortalAction {
  type: "set_portal";
}

function EvaluateSetPortal(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;

  state.portalAreaId = state.currentAreaId;
  return {
    action: {
      type: "set_portal",
    },
  };
}

interface UsePortalAction {
  type: "use_portal";
}

function EvaluateUsePortal(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;
  if (!state.portalAreaId) return "portal must be set";

  const currentArea = areas[state.currentAreaId];
  if (currentArea.id == state.portalAreaId) {
    state.portalAreaId = state.currentAreaId;
    state.currentAreaId = lookup.towns[currentArea.act];
  } else {
    if (!currentArea.is_town_area)
      return "can only use portal from town or portal area";
    state.currentAreaId = state.portalAreaId;
    state.portalAreaId = null;
  }

  return {
    action: {
      type: "use_portal",
    },
  };
}

interface GenericAction {
  type: "generic";
  value: string;
}

function EvaluateGeneric(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;
  return {
    action: {
      type: "generic",
      value: action[1],
    },
  };
}

interface TrialAction {
  type: "trial";
}

function EvaluateTrial(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;
  return {
    action: {
      type: "trial",
    },
  };
}

interface AscendAction {
  type: "ascend";
}

function EvaluateAscend(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 1) return ERROR_INVALID_FORMAT;

  const expectedAreaId = "Labyrinth_Airlock";
  const currentArea = areas[state.currentAreaId];
  if (currentArea.id != expectedAreaId) {
    const expectedArea = areas[expectedAreaId];
    return `must be in "${expectedArea.name}"`;
  }

  state.currentAreaId = state.lastTownAreaId;

  return {
    action: {
      type: "ascend",
    },
  };
}

interface CraftingAction {
  type: "crafting";
  crafting_recipes: string[];
}

function EvaluateCrafting(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length > 2) return ERROR_INVALID_FORMAT;

  let area;
  if (action.length == 1) area = areas[state.currentAreaId];
  else {
    area = areas[action[1]];
    if (!area) return ERROR_MISSING_AREA;
  }
  state.craftingAreas.add(area.id);

  return {
    action: {
      type: "crafting",
      crafting_recipes: area.crafting_recipes,
    },
  };
}

interface DirectionAction {
  type: "dir";
  dirIndex: number;
}

function EvaluateDirection(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  if (action.length != 2) return ERROR_INVALID_FORMAT;

  const parsed = Number.parseFloat(action[1]);
  if (Number.isNaN(parsed)) return "dir value is not a number";

  let dir = parsed % 360;
  if (dir < 0) dir += 360;

  if (dir % 45 != 0) return "dir value must be in intervals of 45";

  return {
    action: {
      type: "dir",
      dirIndex: Math.floor(dir / 45),
    },
  };
}

export type Action =
  | KillAction
  | ArenaAction
  | AreaAction
  | EnterAction
  | TownAction
  | WaypointAction
  | GetWaypointAction
  | SetPortalAction
  | UsePortalAction
  | QuestAction
  | QuestTextAction
  | GenericAction
  | TrialAction
  | AscendAction
  | DirectionAction
  | CraftingAction;

export const ERROR_INVALID_FORMAT = "invalid format";
export const ERROR_MISSING_AREA = "area does not exist";
export const ERROR_AREA_NO_WAYPOINT = "area does not have a waypoint";

export interface EvaluateResult {
  action?: Action;
  additionalSteps?: Step[];
}

function evaluateAction(
  action: ParsedAction,
  lookup: RouteLookup,
  state: RouteState
): string | EvaluateResult {
  switch (action[0]) {
    case "kill":
      return EvaluateKill(action, lookup, state);
    case "arena":
      return EvaluateArena(action, lookup, state);
    case "area":
      return EvaluateArea(action, lookup, state);
    case "enter":
      return EvaluateEnter(action, lookup, state);
    case "town":
      return EvaluateTown(action, lookup, state);
    case "waypoint":
      return EvaluateWaypoint(action, lookup, state);
    case "get_waypoint":
      return EvaluateGetWaypoint(action, lookup, state);
    case "set_portal":
      return EvaluateSetPortal(action, lookup, state);
    case "use_portal":
      return EvaluateUsePortal(action, lookup, state);
    case "quest":
      return EvaluateQuest(action, lookup, state);
    case "quest_text":
      return EvaluateQuestText(action, lookup, state);
    case "generic":
      return EvaluateGeneric(action, lookup, state);
    case "trial":
      return EvaluateTrial(action, lookup, state);
    case "crafting":
      return EvaluateCrafting(action, lookup, state);
    case "ascend":
      return EvaluateAscend(action, lookup, state);
    case "dir":
      return EvaluateDirection(action, lookup, state);
  }

  return ERROR_INVALID_FORMAT;
}

export interface BuildData {
  characterClass: string;
  requiredGems: RequiredGem[];
}

export interface RequiredGem {
  id: string;
  note: string;
}

export function initializeRouteLookup(buildData: BuildData | null) {
  const routeLookup: RouteLookup = {
    towns: {},
    buildData: buildData,
  };

  for (const id in areas) {
    const area = areas[id];
    if (area.is_town_area) routeLookup.towns[area.act] = area.id;
  }

  return routeLookup;
}

export function initializeRouteState() {
  const state: RouteState = {
    implicitWaypoints: new Set(),
    explicitWaypoints: new Set(),
    usedWaypoints: new Set(),
    craftingAreas: new Set(),
    currentAreaId: "1_1_1",
    lastTownAreaId: "1_1_town",
    portalAreaId: null,
    acquiredGems: new Set(),
  };

  return state;
}

export function parseRoute(
  routeSources: string[],
  lookup: RouteLookup,
  state: RouteState
) {
  const routes: Route[] = [];
  for (const routeSource of routeSources) {
    const routeLines = routeSource.split(/(?:\r\n|\r|\n)/g);

    const route: Route = [];
    for (const line of routeLines) {
      if (!line) continue;

      const parsedStep = parseStep(line);
      const step: Step = {
        type: "action_step",
        parts: [],
      };

      const additionalSteps: Step[] = [];
      for (const subStep of parsedStep) {
        if (typeof subStep == "string") {
          step.parts.push(subStep);
        } else {
          const result = evaluateAction(subStep, lookup, state);
          if (typeof result == "string") console.log(`${result}: ${subStep}`);
          else {
            if (result.action) step.parts.push(result.action);
            if (result.additionalSteps)
              additionalSteps.push(...result.additionalSteps);
          }
        }
      }

      if (step.parts.length > 0) route.push(step);
      route.push(...additionalSteps);
    }

    routes.push(route);
  }

  for (const waypoint of state.explicitWaypoints) {
    if (!state.usedWaypoints.has(waypoint)) {
      console.log(`unused waypoint ${waypoint}`);
    }
  }

  for (const key in areas) {
    const area = areas[key];
    if (area.crafting_recipes.length > 0 && !state.craftingAreas.has(area.id))
      console.log(
        `missing crafting area ${area.id}, ${area.crafting_recipes.join(", ")}`
      );
  }

  return routes;
}
