import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(function DynamoDBClientMock() { return {}; }),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({ send: vi.fn() }),
  },
  QueryCommand: vi.fn(function QueryCommandMock(input: unknown) { return { input }; }),
}));

import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoService } from '../DynamoService';

const noop = () => {};
const log = vi.fn(noop);

function makeService() {
  return new DynamoService(log as never);
}

describe('DynamoService.configure', () => {
  it('returns success with current config', () => {
    const svc = makeService();
    const result = svc.configure({ region: 'us-west-2', tableName: 'my-table' });
    expect(result.success).toBe(true);
    expect(result.region).toBe('us-west-2');
    expect(result.tableName).toBe('my-table');
  });

  it('keeps existing values when fields are omitted', () => {
    const svc = makeService();
    svc.configure({ region: 'eu-west-1' });
    const result = svc.configure({ tableName: 'new-table' });
    expect(result.region).toBe('eu-west-1');
    expect(result.tableName).toBe('new-table');
  });

  it('updates endpoint', () => {
    const svc = makeService();
    const result = svc.configure({ endpoint: 'http://dynamo:8000' });
    expect(result.endpoint).toBe('http://dynamo:8000');
  });
});

describe('DynamoService.getConfig', () => {
  it('returns default config before configure', () => {
    const svc = makeService();
    const cfg = svc.getConfig();
    expect(cfg.region).toBe('us-east-1');
    expect(cfg.tableName).toBe('development_blocks');
    expect(cfg.initialized).toBe(false);
  });

  it('reports initialized after configure', () => {
    const svc = makeService();
    svc.configure({});
    expect(svc.getConfig().initialized).toBe(true);
  });
});

describe('DynamoService.fetchItem', () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSend = vi.fn();
    vi.mocked(DynamoDBDocumentClient.from).mockReturnValue({ send: mockSend } as never);
  });

  it('returns data when item found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [{ id: 'abc', name: 'test' }] });
    const svc = makeService();
    svc.configure({});
    const result = await svc.fetchItem('abc');
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: 'abc', name: 'test' });
  });

  it('returns null data when no item found', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const svc = makeService();
    svc.configure({});
    const result = await svc.fetchItem('not-found');
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('returns null data when Items is undefined', async () => {
    mockSend.mockResolvedValueOnce({});
    const svc = makeService();
    svc.configure({});
    const result = await svc.fetchItem('x');
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('re-initialises client if not yet configured', async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const svc = makeService();
    // fetchItem without calling configure first — should auto-init
    const result = await svc.fetchItem('y');
    expect(result.success).toBe(true);
  });

  it('propagates send errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('Timeout'));
    const svc = makeService();
    svc.configure({});
    await expect(svc.fetchItem('z')).rejects.toThrow('Timeout');
  });
});

describe('DynamoService environments', () => {
  it('records the environment id alongside the resolved table', () => {
    const svc = makeService();
    const result = svc.configure({ environment: 'plive', tableName: 'plive_blocks', endpoint: '' });
    expect(result.environment).toBe('plive');
    expect(result.tableName).toBe('plive_blocks');
    expect(result.endpoint).toBe('');
  });

  it('keeps each environment switch independent', () => {
    const svc = makeService();
    svc.configure({ environment: 'stage', tableName: 'stage_blocks', region: 'eu-west-1', endpoint: '' });
    const back = svc.configure({
      environment: 'local',
      tableName: 'development_blocks',
      region: 'us-east-1',
      endpoint: 'http://localhost:8000',
    });
    expect(back.environment).toBe('local');
    expect(back.tableName).toBe('development_blocks');
    expect(back.region).toBe('us-east-1');
    expect(back.endpoint).toBe('http://localhost:8000');
  });

  it('carries an AWS profile through and can clear it again', () => {
    const svc = makeService();
    expect(svc.configure({ profile: 'krisp-plive' }).profile).toBe('krisp-plive');
    expect(svc.configure({ profile: '' }).profile).toBe('');
  });

  it('defaults to the local environment before any configure call', () => {
    const cfg = makeService().getConfig();
    expect(cfg.environment).toBe('local');
    expect(cfg.profile).toBe('');
  });
});
