using System.Buffers.Binary;
using System.IO.MemoryMappedFiles;
using System.Text;

namespace MyLMUHub.Core;

/// <summary>Read access to a block of memory: the live game (memory-mapped file) or a saved image (bytes). The reader code is the same for both.</summary>
public abstract class MemView
{
    public abstract long Length { get; }
    public abstract byte U8(long p);
    public abstract short I16(long p);
    public abstract ushort U16(long p);
    public abstract int I32(long p);
    public abstract uint U32(long p);
    public abstract long I64(long p);
    public abstract ulong U64(long p);
    public abstract float F32(long p);
    public abstract double F64(long p);
    public abstract void Bytes(long p, byte[] buf, int len);

    public double Num(FieldDef f, long pos)
    {
        switch (f.Type)
        {
            case "f64": return F64(pos);
            case "f32": return F32(pos);
            case "i32": return I32(pos);
            case "u32": return U32(pos);
            case "i16": return I16(pos);
            case "u16": return U16(pos);
            case "i8": return (sbyte)U8(pos);
            case "u8": return U8(pos);
            case "bool": return U8(pos) != 0 ? 1.0 : 0.0;
            case "i64": return I64(pos);
            case "u64": return U64(pos);
        }
        return 0.0;
    }

    [ThreadStatic] static byte[] strBuf;

    public string Str(FieldDef f, long pos)
    {
        strBuf ??= new byte[256];
        int len = Math.Min(f.Len, strBuf.Length);
        Bytes(pos, strBuf, len);
        int n = 0;
        while (n < len && strBuf[n] != 0) n++;
        return n == 0 ? "" : Encoding.UTF8.GetString(strBuf, 0, n);
    }
}

public sealed class BytesView : MemView
{
    readonly byte[] b;
    public BytesView(byte[] bytes) { b = bytes; }
    public override long Length => b.Length;
    public override byte U8(long p) => b[p];
    public override short I16(long p) => BinaryPrimitives.ReadInt16LittleEndian(b.AsSpan((int)p));
    public override ushort U16(long p) => BinaryPrimitives.ReadUInt16LittleEndian(b.AsSpan((int)p));
    public override int I32(long p) => BinaryPrimitives.ReadInt32LittleEndian(b.AsSpan((int)p));
    public override uint U32(long p) => BinaryPrimitives.ReadUInt32LittleEndian(b.AsSpan((int)p));
    public override long I64(long p) => BinaryPrimitives.ReadInt64LittleEndian(b.AsSpan((int)p));
    public override ulong U64(long p) => BinaryPrimitives.ReadUInt64LittleEndian(b.AsSpan((int)p));
    public override float F32(long p) => BinaryPrimitives.ReadSingleLittleEndian(b.AsSpan((int)p));
    public override double F64(long p) => BinaryPrimitives.ReadDoubleLittleEndian(b.AsSpan((int)p));
    public override void Bytes(long p, byte[] buf, int len) => Array.Copy(b, p, buf, 0, len);
}

public sealed class AccessorView : MemView
{
    readonly MemoryMappedViewAccessor a;
    public AccessorView(MemoryMappedViewAccessor accessor) { a = accessor; }
    public override long Length => a.Capacity;
    public override byte U8(long p) => a.ReadByte(p);
    public override short I16(long p) => a.ReadInt16(p);
    public override ushort U16(long p) => a.ReadUInt16(p);
    public override int I32(long p) => a.ReadInt32(p);
    public override uint U32(long p) => a.ReadUInt32(p);
    public override long I64(long p) => a.ReadInt64(p);
    public override ulong U64(long p) => a.ReadUInt64(p);
    public override float F32(long p) => a.ReadSingle(p);
    public override double F64(long p) => a.ReadDouble(p);
    public override void Bytes(long p, byte[] buf, int len) => a.ReadArray(p, buf, 0, len);
}
