/**
 * DiceDuel SVM Plugin — Single Entry Point
 *
 * Bundles program, tables, handlers, API, and aggregates
 * into one SvmPluginDescriptor via defineSvmPlugin().
 */

import { defineSvmPlugin } from "@anterra/3p-plugin-sdk/indexer";
import type { DiceDuelEventMap } from "../event-data";
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

export const diceDuelSvmPlugin = defineSvmPlugin<DiceDuelEventMap>({
	id: "dice-duel",
	name: "Dice Duel",
	version: "2.0.0",
	program: diceDuelProgram,
	tables: { wagerTable, diceBagTable, playerStatsTable, gameConfigTable, wagerEventLog },
	handlers: [wagerHandler, diceBagHandler, playerStatsHandler, gameConfigHandler],
	api: svmApi,
	aggregates: { hourlyWagerStats, dailyWagerStats },
	sourceModules: [
		"@anterra/3p-plugin-dice-duel/indexing-svm",
		"@anterra/3p-plugin-dice-duel/svm",
	],
});
