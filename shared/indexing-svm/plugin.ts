/**
 * DiceDuel SVM Plugin — Single Entry Point
 *
 * Bundles program, tables, handlers, API, and aggregates
 * into one SvmPluginDescriptor via defineSvmPlugin().
 */

import { defineSvmPlugin } from "@townexchange/3p-plugin-sdk/indexer";
import type { DragonDiceEventMap } from "../event-data";
import { diceDuelProgram } from "../svm/program";
import {
	wagerTable,
	diceBagTable,
	playerStatsTable,
	gameConfigTable,
	wagerEventLog,
} from "./schema";
import {
	wagerHandler,
	diceBagHandler,
	playerStatsHandler,
	gameConfigHandler,
} from "./handlers";
import { svmApi } from "./api";
import { hourlyWagerStats, dailyWagerStats } from "./aggregates";

export const dragonDiceSvmPlugin = defineSvmPlugin<DragonDiceEventMap>({
	id: "dragon-dice",
	name: "Dragon Dice",
	version: "2.0.0",
	program: diceDuelProgram,
	tables: { wagerTable, diceBagTable, playerStatsTable, gameConfigTable, wagerEventLog },
	handlers: [wagerHandler, diceBagHandler, playerStatsHandler, gameConfigHandler],
	api: svmApi,
	aggregates: { hourlyWagerStats, dailyWagerStats },
	sourceModules: [
		"@townexchange/3p-plugin-dragon-dice/indexing-svm",
		"@townexchange/3p-plugin-dragon-dice/svm",
	],
});
