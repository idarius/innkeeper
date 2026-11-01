-- InnkeeperSync : export pour Innkeeper, le portail de guilde (WoW Forever, client de type Retail).
--
-- Rien n'est envoyé nulle part : l'addon remplit InnkeeperSyncDB, que le jeu écrit dans
-- WTF/Account/<COMPTE>/SavedVariables/InnkeeperSync.lua à la déconnexion (ou /reload).
-- Ce fichier se dépose ensuite sur le site. Chaque connexion d'un perso repart de zéro :
-- le fichier est commun à tous les persos du compte, et le site attribue les métiers et
-- recettes au perso connecté. La bêta de Forever ne relisait pas les SavedVariables ;
-- un jeu qui les relit ne doit pas mélanger les données de deux persos.
--
-- Contenu :
--   roster           registre de guilde (niveau, classe, rang, dernière connexion)
--   guildProfessions métiers de tous les membres, avec leur niveau (onglet Métiers de guilde)
--   professions      métiers du perso connecté
--   recipes          recettes connues, pour chaque fenêtre de métier ouverte pendant la session

local ADDON = "InnkeeperSync"
local FORMAT_VERSION = 1

-- Remis à zéro à la connexion (PLAYER_LOGIN).
InnkeeperSyncDB = InnkeeperSyncDB

local function log(msg)
	print("|cffd4a017Innkeeper|r " .. msg)
end

-- Appel protégé : une fonction absente ou en erreur ne doit jamais bloquer l'export.
-- Toutes les valeurs sont transmises : GetGuildTradeSkillInfo renvoie le niveau en 13e.
local function passOn(ok, ...)
	if ok then return ... end
	return nil
end
local function try(fn, ...)
	if type(fn) ~= "function" then return nil end
	return passOn(pcall(fn, ...))
end

local function stripRealm(name)
	if not name then return nil end
	return (name:gsub("%-.*$", ""))
end

local function header()
	local name = UnitName("player")
	local _, classFile = UnitClass("player")
	local _, raceFile = UnitRace("player")
	local guild, rankName = try(GetGuildInfo, "player")
	InnkeeperSyncDB.format = FORMAT_VERSION
	InnkeeperSyncDB.exportedAt = (try(GetServerTime)) or time()
	InnkeeperSyncDB.locale = try(GetLocale)
	InnkeeperSyncDB.player = {
		name = name,
		level = UnitLevel("player"),
		class = classFile,
		race = raceFile,
		faction = (try(UnitFactionGroup, "player")),
		guild = guild,
		rank = rankName,
	}
end

local function readRoster()
	if not IsInGuild() then return end
	local total = try(GetNumGuildMembers) or 0
	if total == 0 then return end
	local roster = {}
	for i = 1, total do
		-- Les notes du registre et la zone ne sont pas exportées : le site ne s'en sert pas, et
		-- les notes d'officier n'ont pas à quitter le jeu (le fichier part sur Internet).
		local name, rankName, rankIndex, level, _, _, _, _, online, _, classFile = try(GetGuildRosterInfo, i)
		if name then
			local years, months, days, hours = try(GetGuildRosterLastOnline, i)
			roster[#roster + 1] = {
				name = stripRealm(name),
				level = level,
				class = classFile,
				rank = rankName,
				rankIndex = rankIndex,
				online = online and true or false,
				offline = { years = years or 0, months = months or 0, days = days or 0, hours = hours or 0 },
			}
		end
	end
	InnkeeperSyncDB.roster = roster
	InnkeeperSyncDB.rosterAt = (try(GetServerTime)) or time()
end

-- Onglet « Métiers » de la guilde : des en-têtes (un par métier) suivis de leurs membres.
local function readGuildProfessions()
	if not IsInGuild() then return end
	-- Tout déplier : les membres d'un métier replié ne sont pas listés.
	for _ = 1, 3 do
		local expanded = false
		for i = 1, (try(GetNumGuildTradeSkill) or 0) do
			local skillID, collapsed, _, headerName = try(GetGuildTradeSkillInfo, i)
			if headerName and collapsed and skillID then
				try(ExpandGuildTradeSkillHeader, skillID)
				expanded = true
			end
		end
		if not expanded then break end
	end

	local result, current = {}, nil
	for i = 1, (try(GetNumGuildTradeSkill) or 0) do
		local skillID, _, _, headerName, _, _, _, playerName, _, _, _, _, skill = try(GetGuildTradeSkillInfo, i)
		if headerName then
			current = { skillLine = skillID, name = headerName, members = {} }
			result[#result + 1] = current
		elseif current and playerName then
			current.members[#current.members + 1] = { name = stripRealm(playerName), skill = skill }
		end
	end
	if #result > 0 then
		InnkeeperSyncDB.guildProfessions = result
	end
end

local function readOwnProfessions()
	local list = {}
	-- Les emplacements vides valent nil (1, nil, nil, 2…) : ipairs s'arrêterait au premier.
	local slots = { try(GetProfessions) }
	for slot = 1, 6 do
		local index = slots[slot]
		if index then
			local name, _, rank, maxRank, _, _, skillLine = try(GetProfessionInfo, index)
			if name then
				list[#list + 1] = { skillLine = skillLine, name = name, skill = rank, max = maxRank }
			end
		end
	end
	InnkeeperSyncDB.professions = list
end

-- Recettes : seulement quand le joueur ouvre la fenêtre d'un de SES métiers.
local function readRecipes()
	if not C_TradeSkillUI or not try(C_TradeSkillUI.IsTradeSkillReady) then return end
	if try(C_TradeSkillUI.IsTradeSkillLinked) or try(C_TradeSkillUI.IsTradeSkillGuild) then return end
	local base = try(C_TradeSkillUI.GetBaseProfessionInfo)
	if not base or not base.professionID then return end
	local learned = {}
	for _, recipeID in ipairs(try(C_TradeSkillUI.GetAllRecipeIDs) or {}) do
		local info = try(C_TradeSkillUI.GetRecipeInfo, recipeID)
		if info and info.learned then
			learned[#learned + 1] = { id = recipeID, name = info.name }
		end
	end
	-- Rangées par métier : rouvrir une fenêtre remplace la liste au lieu de la doubler.
	InnkeeperSyncDB.recipes = InnkeeperSyncDB.recipes or {}
	InnkeeperSyncDB.recipes["skill" .. base.professionID] = {
		skillLine = base.professionID,
		name = base.professionName,
		skill = base.skillLevel,
		list = learned,
	}
	log(("%d recettes de %s enregistrées."):format(#learned, base.professionName or "?"))
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("GUILD_ROSTER_UPDATE")
frame:RegisterEvent("GUILD_TRADESKILL_UPDATE")
frame:RegisterEvent("SKILL_LINES_CHANGED")
frame:RegisterEvent("TRADE_SKILL_LIST_UPDATE")
frame:SetScript("OnEvent", function(_, event)
	if event == "PLAYER_LOGIN" then
		-- Rien de la session d'un autre perso du compte : recettes, registre d'une autre guilde…
		InnkeeperSyncDB = {}
		header()
		readOwnProfessions()
		if IsInGuild() then try(C_GuildInfo and C_GuildInfo.GuildRoster) end
	elseif event == "GUILD_ROSTER_UPDATE" then
		readRoster()
		readGuildProfessions()
	elseif event == "GUILD_TRADESKILL_UPDATE" then
		readGuildProfessions()
	elseif event == "SKILL_LINES_CHANGED" then
		readOwnProfessions()
	elseif event == "TRADE_SKILL_LIST_UPDATE" then
		readRecipes()
	end
end)

SLASH_INNKEEPERSYNC1 = "/innkeeper"
SLASH_INNKEEPERSYNC2 = "/ik"
SlashCmdList.INNKEEPERSYNC = function()
	InnkeeperSyncDB = InnkeeperSyncDB or {}
	header()
	readOwnProfessions()
	if IsInGuild() then try(C_GuildInfo and C_GuildInfo.GuildRoster) end
	readRoster()
	readGuildProfessions()
	local professions = 0
	for _, p in ipairs(InnkeeperSyncDB.guildProfessions or {}) do professions = professions + #p.members end
	local crafts = 0
	for _ in pairs(InnkeeperSyncDB.recipes or {}) do crafts = crafts + 1 end
	log(("Registre : %d membres. Métiers de guilde : %d entrées. Recettes : %d métier(s)."):format(
		#(InnkeeperSyncDB.roster or {}), professions, crafts))
	log("Tape /reload (ou déconnecte-toi) pour écrire le fichier, puis dépose-le sur le site.")
end
