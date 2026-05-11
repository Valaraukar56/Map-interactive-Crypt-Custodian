// Script UTMT — exporte toutes les rooms + leurs objects (avec position x,y)
// en JSON, pour processing ensuite par notre script Python.
//
// USAGE dans UndertaleModTool :
//   1. File > Open... > data.win de Crypt Custodian
//   2. Scripts > Run other script... > choisir ce fichier export_utmt.csx
//   3. Le JSON sera créé à côté du data.win
//
// Output : crypt_custodian_export.json

using System;
using System.IO;
using System.Text;
using System.Linq;
using UndertaleModLib.Models;

EnsureDataLoaded();

string outDir = Path.GetDirectoryName(FilePath);
string outPath = Path.Combine(outDir, "crypt_custodian_export.json");
string objListPath = Path.Combine(outDir, "crypt_custodian_objects.txt");
string roomListPath = Path.Combine(outDir, "crypt_custodian_rooms.txt");

// dump la liste complete des noms d'objets pour qu'on puisse identifier
// ceux qui nous interessent meme s'ils ont des noms inattendus
var objNames = Data.GameObjects.Select(o => o.Name?.Content ?? "?").OrderBy(s => s).ToList();
File.WriteAllLines(objListPath, objNames);

// pareil pour les rooms
var roomNames = Data.Rooms.Select(r => r.Name?.Content ?? "?").OrderBy(s => s).ToList();
File.WriteAllLines(roomListPath, roomNames);

var sb = new StringBuilder();
sb.Append("{\n");
sb.Append("  \"rooms\": [\n");

bool firstRoom = true;
int totalRooms = 0, totalInstances = 0;

foreach (var room in Data.Rooms)
{
    string name = room.Name?.Content ?? "?";

    // skip dev / system rooms
    if (name.StartsWith("rm_")) continue;
    if (name.Contains("template", StringComparison.OrdinalIgnoreCase)) continue;
    if (name.Contains("Test", StringComparison.Ordinal)) continue;
    if (name.Contains("test", StringComparison.Ordinal)) continue;
    if (name.Contains("Example", StringComparison.OrdinalIgnoreCase)) continue;
    if (name.StartsWith("Room") || name == "New_room") continue;
    if (name.StartsWith("Rush_") || name == "BossRushMenu") continue;
    if (name == "InitGameControl" || name == "Back_Test" || name == "r_expire") continue;
    if (name.StartsWith("ACutscene_")) continue;
    if (name.EndsWith("old")) continue;
    if (name.EndsWith("b") && char.IsDigit(name[name.Length - 2])) continue;

    if (!firstRoom) sb.Append(",\n");
    firstRoom = false;
    totalRooms++;

    sb.Append("    {\n");
    sb.Append($"      \"name\": \"{Escape(name)}\",\n");
    sb.Append($"      \"width\": {room.Width},\n");
    sb.Append($"      \"height\": {room.Height},\n");
    sb.Append("      \"instances\": [");

    bool firstInst = true;
    foreach (var inst in room.GameObjects)
    {
        string objName = inst.ObjectDefinition?.Name?.Content;
        if (objName == null) continue;

        // ne garder que ce qui peut nous intéresser comme collectible / NPC / boss
        if (!IsInteresting(objName)) continue;

        if (!firstInst) sb.Append(",");
        firstInst = false;
        totalInstances++;

        sb.Append($"\n        {{\"obj\":\"{Escape(objName)}\",\"x\":{inst.X},\"y\":{inst.Y}}}");
    }

    sb.Append(firstInst ? "]\n" : "\n      ]\n");
    sb.Append("    }");
}

sb.Append("\n  ]\n}\n");

File.WriteAllText(outPath, sb.ToString());
ScriptMessage(
    $"Exporte :\n" +
    $"  - {Data.Rooms.Count} rooms totales, {totalRooms} apres filtrage\n" +
    $"  - {totalInstances} instances d'objets interessants\n" +
    $"  - {objNames.Count} noms d'objets distincts dans le jeu\n\n" +
    $"3 fichiers crees a cote de data.win :\n" +
    $"  - crypt_custodian_export.json (donnees structurees)\n" +
    $"  - crypt_custodian_objects.txt (tous les noms d'objets)\n" +
    $"  - crypt_custodian_rooms.txt (tous les noms de rooms)");

bool IsInteresting(string n)
{
    string s = n.ToLowerInvariant();
    return s.Contains("crouton") || s.Contains("photo") || s.Contains("picture")
        || s == "o_cd" || s.StartsWith("o_cd_") || s.Contains("disc") || s.Contains("juke")
        || s.Contains("curse")
        || s.Contains("ability")
        || s.Contains("constellation") || s.Contains("special")
        || s.Contains("upgrade") || s.Contains("attack_up") || s.Contains("attack_add")
        || s.Contains("spirit") || s.Contains("vase") || s.Contains("jar") || s.Contains("trapped")
        || s.Contains("boss") || s.Contains("npc")
        || s.Contains("save") || s.Contains("shrine") || s.Contains("checkpoint")
        || s.Contains("mira") || s.Contains("grizz") || s.Contains("pebble")
        || s.Contains("shop") || s.Contains("inn") || s.Contains("bar");
}

string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
