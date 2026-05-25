import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';

/**
 * AES-256-GCM encryption utility for sensitive data (OAuth tokens, etc.)
 * Uses ENCRYPTION_KEY from environment (32-byte hex string)
 */
@Injectable()
export class CryptoUtil {
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const encryptionKey = this.config.get<string>('ENCRYPTION_KEY', '');
    if (!encryptionKey || encryptionKey.length !== 64) {
      throw new Error(
        'ENCRYPTION_KEY must be a 32-byte hex string (64 characters). ' +
        'Generate with: openssl rand -hex 32'
      );
    }
    this.key = Buffer.from(encryptionKey, 'hex');
  }

  /**
   * Encrypt plaintext using AES-256-GCM
   * Returns base64-encoded string with format: iv:authTag:ciphertext
   */
  encrypt(plaintext: string): string {
    if (!plaintext) return '';
    
    const iv = crypto.randomBytes(16); // 16-byte IV for GCM
    const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Format: iv:authTag:ciphertext (all base64-encoded)
    return `${iv.toString('base64')}:${authTag.toString('base64')}:${Buffer.from(encrypted, 'hex').toString('base64')}`;
  }

  /**
   * Decrypt ciphertext using AES-256-GCM
   * Expects format: iv:authTag:ciphertext (all base64-encoded)
   */
  decrypt(ciphertext: string): string {
    if (!ciphertext) return '';
    
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid ciphertext format');
      }
      
      const iv = Buffer.from(parts[0], 'base64');
      const authTag = Buffer.from(parts[1], 'base64');
      const encrypted = Buffer.from(parts[2], 'base64');
      
      const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      throw new Error(`Decryption failed: ${(error as Error).message}`);
    }
  }
}
