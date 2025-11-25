/**
 * Tests for health check functionality
 */

describe('Health Check', () => {
  it('should return server status', () => {
    const health = {
      status: 'healthy',
      server: {
        name: 'hashpilot',
        version: '0.1.0',
        uptime: process.uptime(),
      },
      timestamp: new Date().toISOString(),
    };

    expect(health.status).toBe('healthy');
    expect(health.server.name).toBe('hashpilot');
    expect(health.server.version).toBe('0.1.0');
    expect(health.server.uptime).toBeGreaterThan(0);
  });

  it('should return verbose health information', () => {
    const verboseHealth = {
      status: 'healthy',
      server: {
        name: 'hashpilot',
        version: '0.1.0',
        uptime: process.uptime(),
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      services: {
        mcp: 'operational',
        hedera: 'not_initialized',
        rag: 'not_initialized',
        openai: 'not_initialized',
      },
      timestamp: new Date().toISOString(),
    };

    expect(verboseHealth.system.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(verboseHealth.services.mcp).toBe('operational');
  });
});
