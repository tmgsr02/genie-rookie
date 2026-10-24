import Foundation

/// Raw signed little-endian PCM16 → normalized Float32. HTTP boundaries may split
/// a two-byte sample; preserve its low byte across append calls.
struct PCM16StreamDecoder {
    private var lowByte: UInt8?
    mutating func append(_ bytes: some Sequence<UInt8>) -> [Float] {
        var samples: [Float] = []
        for byte in bytes {
            if let lowByte {
                let bits = UInt16(lowByte) | UInt16(byte) << 8
                samples.append(Float(Int16(bitPattern: bits)) / 32768.0)
                self.lowByte = nil
            } else { lowByte = byte }
        }
        return samples
    }
    func finish() throws {
        guard lowByte == nil else {
            throw VoiceError(message: "Boson audio ended with an incomplete PCM sample. Retry this reply.")
        }
    }
}
