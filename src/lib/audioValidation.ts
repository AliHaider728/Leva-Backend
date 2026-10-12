export const AUDIO_TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a' };
export function validAudio(buffer: Buffer, mime: string) { if (!AUDIO_TYPES[mime] || buffer.length < 12)
    return false; const ascii = buffer.toString('ascii', 0, 12); if (mime === 'audio/mpeg')
    return ascii.startsWith('ID3') || (buffer[0] === 255 && (buffer[1] & 224) === 224); if (mime.includes('wav'))
    return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE'; if (mime === 'audio/ogg')
    return ascii.startsWith('OggS'); if (mime === 'audio/webm')
    return buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163])); return ascii.slice(4, 8) === 'ftyp'; }
