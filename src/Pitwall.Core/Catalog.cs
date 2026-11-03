using System.Text.Json;

namespace Pitwall.Core;

/// <summary>One field in LMU's shared memory: where it is and what it is. Type: i8 u8 i16 u16 i32 u32 i64 u64 f32 f64 bool str.</summary>
public sealed class FieldDef
{
    public int Offset;
    public string Type;
    public int Len;     // strings only
}

/// <summary>A block of the shared memory: one struct (Stride == 0) or an array of identical structs.</summary>
public sealed class Section
{
    public long Base;
    public int Stride;
    public Dictionary<string, FieldDef> Fields = new(StringComparer.Ordinal);
    public FieldDef this[string name] => Fields[name];
}

/// <summary>Every field of the shared memory with its byte offset (lmu_fields.json). Regenerate with tools/gen_catalog.py after a game update.</summary>
public sealed class Catalog
{
    public string MapName;
    public long MapSize;
    public int MaxVehicles;
    public Section Session;      // ScoringInfoV01
    public Section VehScoring;   // VehicleScoringInfoV01[]
    public Section TelemHeader;  // activeVehicles, playerVehicleIdx, playerHasVehicle
    public Section Telem;        // TelemInfoV01[] (PACKED: only the first activeVehicles entries are filled, each carries its own slot id in mID)

    public static Catalog LoadEmbedded()
    {
        var asm = typeof(Catalog).Assembly;
        using var s = asm.GetManifestResourceStream("lmu_fields.json") ?? throw new InvalidOperationException("embedded lmu_fields.json is missing");
        using var r = new StreamReader(s);
        return Parse(r.ReadToEnd());
    }

    public static Catalog Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        var o = doc.RootElement;
        return new Catalog
        {
            MapName = o.GetProperty("mapName").GetString(),
            MapSize = o.GetProperty("mapSize").GetInt64(),
            MaxVehicles = o.GetProperty("maxVehicles").GetInt32(),
            Session = Read(o.GetProperty("scoringInfo")),
            VehScoring = Read(o.GetProperty("vehScoring")),
            TelemHeader = Read(o.GetProperty("telemHeader")),
            Telem = Read(o.GetProperty("telem")),
        };
    }

    static Section Read(JsonElement e)
    {
        var s = new Section { Base = e.GetProperty("base").GetInt64(), Stride = e.TryGetProperty("stride", out var st) ? st.GetInt32() : 0 };
        foreach (var p in e.GetProperty("fields").EnumerateObject())
        {
            s.Fields[p.Name] = new FieldDef
            {
                Offset = p.Value.GetProperty("o").GetInt32(),
                Type = p.Value.GetProperty("t").GetString(),
                Len = p.Value.TryGetProperty("n", out var n) ? n.GetInt32() : 0,
            };
        }
        return s;
    }
}
