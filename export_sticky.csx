// Script UTMT — dump tous les o_sticky_view de toutes les rooms.
// Hypothèse : chaque room a un o_sticky_view qui encode sa position et
// sa taille sur la s_map (world map). Si confirmé, on a un mapping
// automatique room -> position sans aucun placement manuel.
//
// USAGE :
//   1. data.win ouvert dans UTMT
//   2. Scripts > Run other script... > export_sticky.csx
//   3. Output : crypt_custodian_sticky.json a cote de data.win

using System;
using System.IO;
using System.Text;
using System.Linq;
using UndertaleModLib.Models;

EnsureDataLoaded();

string outPath = Path.Combine(Path.GetDirectoryName(FilePath), "crypt_custodian_sticky.json");

var sb = new StringBuilder();
sb.Append("{\n  \"rooms\": [\n");

bool firstRoom = true;
int totalSticky = 0;
int roomsWithSticky = 0;

foreach (var room in Data.Rooms)
{
    string roomName = room.Name?.Content ?? "?";

    // Cherche tous les o_sticky_view dans cette room
    var stickies = room.GameObjects
        .Where(inst => inst.ObjectDefinition?.Name?.Content == "o_sticky_view")
        .ToList();

    if (stickies.Count == 0) continue;
    roomsWithSticky++;

    if (!firstRoom) sb.Append(",\n");
    firstRoom = false;

    sb.Append("    {\n");
    sb.Append($"      \"room\": \"{Escape(roomName)}\",\n");
    sb.Append($"      \"roomWidth\": {room.Width},\n");
    sb.Append($"      \"roomHeight\": {room.Height},\n");
    sb.Append("      \"sticky\": [");

    bool firstSticky = true;
    foreach (var s in stickies)
    {
        totalSticky++;
        if (!firstSticky) sb.Append(",");
        firstSticky = false;

        // ScaleX et ScaleY peuvent être de différents types selon la version d'UTMT
        float scaleX = (float)s.ScaleX;
        float scaleY = (float)s.ScaleY;
        float rotation = (float)s.Rotation;

        sb.Append($"\n        {{\"x\": {s.X}, \"y\": {s.Y}, \"sx\": {scaleX.ToString(System.Globalization.CultureInfo.InvariantCulture)}, \"sy\": {scaleY.ToString(System.Globalization.CultureInfo.InvariantCulture)}, \"rot\": {rotation.ToString(System.Globalization.CultureInfo.InvariantCulture)}, \"id\": {s.InstanceID}}}");
    }

    sb.Append(firstSticky ? "]\n" : "\n      ]\n");
    sb.Append("    }");
}

sb.Append("\n  ]\n}\n");

File.WriteAllText(outPath, sb.ToString());
ScriptMessage(
    $"Export sticky_view :\n" +
    $"  {roomsWithSticky} rooms avec o_sticky_view\n" +
    $"  {totalSticky} instances totales\n\n" +
    $"Fichier : {outPath}");

string Escape(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
