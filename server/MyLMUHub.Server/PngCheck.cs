using System.Buffers.Binary;
using System.IO.Compression;

namespace MyLMUHub.Server;

/// <summary>Team logos (2026-11-16): a member's upload is untrusted. Only a small, plain PNG is accepted, and what is kept is NOT the upload: the pixels are
/// read out and a new PNG is written from them alone. So nothing riding along (text chunks, a colour profile, a second file glued after the end, odd
/// compression tricks) survives; the stored file is just a picture.
/// Accepted: the PNG signature, IHDR first (1..512 px each way, 8 bits, colour type 2 RGB or 6 RGBA, no interlace), chunks with valid lengths and CRCs,
/// IDAT data that unpacks to exactly height x (1 + width x channels) bytes with a valid filter byte on every row, IEND last and nothing after it.
/// Ancillary chunks (tEXt, iCCP, ...) are allowed in the upload but dropped. Pure (tests: ServerTests).</summary>
public static class PngCheck
{
    public const int MaxBytes = 180_000, MaxSide = 512;   // the request body is at most 256 KB: base64 of 180 KB fits
    static readonly byte[] Sig = { 137, 80, 78, 71, 13, 10, 26, 10 };

    public static (byte[] Png, string Why) Clean(byte[] b)
    {
        if (b == null || b.Length < 8 + 25 + 12 || b.Length > MaxBytes) return (null, "size");
        if (!b.AsSpan(0, 8).SequenceEqual(Sig)) return (null, "not a PNG");
        int p = 8, w = 0, h = 0, channels = 0; bool ihdr = false, iend = false; using var idat = new MemoryStream();
        while (p < b.Length)
        {
            if (iend) return (null, "data after the end");
            if (p + 12 > b.Length) return (null, "cut short");
            uint len = BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(p)); if (len > (uint)(b.Length - p - 12)) return (null, "chunk length");
            var type = b.AsSpan(p + 4, 4); var data = b.AsSpan(p + 8, (int)len);
            foreach (var c in type) if (!(c is >= (byte)'A' and <= (byte)'Z' or >= (byte)'a' and <= (byte)'z')) return (null, "chunk type");
            if (Crc(b.AsSpan(p + 4, 4 + (int)len)) != BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(p + 8 + (int)len))) return (null, "checksum");
            string t = System.Text.Encoding.ASCII.GetString(type);
            if (!ihdr && t != "IHDR") return (null, "IHDR first");
            switch (t)
            {
                case "IHDR":
                    if (ihdr || len != 13) return (null, "IHDR");
                    w = (int)BinaryPrimitives.ReadUInt32BigEndian(data); h = (int)BinaryPrimitives.ReadUInt32BigEndian(data[4..]);
                    if (w < 1 || h < 1 || w > MaxSide || h > MaxSide) return (null, "picture size");
                    if (data[8] != 8 || data[10] != 0 || data[11] != 0 || data[12] != 0) return (null, "PNG kind");
                    channels = data[9] == 6 ? 4 : data[9] == 2 ? 3 : 0; if (channels == 0) return (null, "colour type");
                    ihdr = true; break;
                case "IDAT": idat.Write(data); break;
                case "IEND": if (len != 0) return (null, "IEND"); iend = true; break;
                case "PLTE": return (null, "palette");
                default: if ((type[0] & 0x20) == 0) return (null, "unknown critical chunk"); break;   // ancillary: dropped
            }
            p += 12 + (int)len;
        }
        if (!ihdr || !iend || idat.Length == 0) return (null, "incomplete");
        // the pixels: exactly the expected size (a zip bomb or extra data both fail), every row starting with a filter type 0..4
        long rowLen = 1 + (long)w * channels, need = rowLen * h; var raw = new byte[need];
        try
        {
            idat.Position = 0; using var z = new ZLibStream(idat, CompressionMode.Decompress);
            int got = 0; while (got < need) { int n = z.Read(raw, got, (int)(need - got)); if (n <= 0) break; got += n; }
            if (got != need || z.Read(new byte[1], 0, 1) != 0) return (null, "pixel data");
        }
        catch (InvalidDataException) { return (null, "pixel data"); }
        for (long r = 0; r < h; r++) if (raw[r * rowLen] > 4) return (null, "pixel data");
        // a new PNG from the pixels only
        using var o = new MemoryStream(); o.Write(Sig);
        var hdr = new byte[13]; BinaryPrimitives.WriteUInt32BigEndian(hdr, (uint)w); BinaryPrimitives.WriteUInt32BigEndian(hdr.AsSpan(4), (uint)h);
        hdr[8] = 8; hdr[9] = (byte)(channels == 4 ? 6 : 2); Chunk(o, "IHDR", hdr);
        using (var zc = new MemoryStream()) { using (var z = new ZLibStream(zc, CompressionLevel.Optimal, true)) z.Write(raw); Chunk(o, "IDAT", zc.ToArray()); }
        Chunk(o, "IEND", Array.Empty<byte>());
        return (o.ToArray(), null);
    }

    static void Chunk(Stream o, string type, byte[] data)
    {
        Span<byte> four = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(four, (uint)data.Length); o.Write(four);
        var td = new byte[4 + data.Length]; System.Text.Encoding.ASCII.GetBytes(type, td); data.CopyTo(td, 4); o.Write(td);
        BinaryPrimitives.WriteUInt32BigEndian(four, Crc(td)); o.Write(four);
    }

    static readonly uint[] Table = Enumerable.Range(0, 256).Select(n => { uint c = (uint)n; for (int k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1; return c; }).ToArray();
    public static uint Crc(ReadOnlySpan<byte> d) { uint c = 0xFFFFFFFFu; foreach (var x in d) c = Table[(c ^ x) & 0xFF] ^ (c >> 8); return c ^ 0xFFFFFFFFu; }
}
