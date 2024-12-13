// EnderNET.ts
import { Module, Command, Socket, Permission, Argument, Description } from '../decorators.ts';
import { text, button, container, alert, divider } from '../tellraw-ui.ts';
import { ScriptContext } from '../types.ts';
// import { parseMarkdown } from './markdown-parser.ts'; // You'd need to implement this

interface DomainData {
  name: string;
  tld: string;
  owner: string;
  purchaseDate: string;
  expiryDate: string;
  isPublic: boolean;
  price: number | null; // null if not for sale
  files: {
    [key: string]: {
      content: string;
      lastModified: string;
    };
  };
}

@Module({
  name: 'EnderNET',
  version: '1.0.0',
  description: 'Domain and web content management system for Minecraft'
})
export class EnderNET {
  private readonly DOMAIN_COST = 10; // XPL per month
  private readonly MAX_FILE_SIZE = 10000;
  private readonly VALID_TLDS = ['.end', '.craft', '.nether', '.void', '.aether'];
  private readonly VALID_FILES = ['index.tmd', 'blog.tmd', 'about.tmd'];
  private readonly RENEWAL_CHECK_INTERVAL = 1000 * 60 * 60; // Check every hour

  constructor() {
    // Start renewal check loop
    this.startRenewalCheck();
  }

  private async startRenewalCheck() {
    setInterval(async () => {
      try {
        const kv = await Deno.openKv();
        const domainsIterator = kv.list({ prefix: ['endernet', 'domains'] });
        const now = new Date();

        for await (const entry of domainsIterator) {
          const domain = entry.value as DomainData;
          const expiry = new Date(domain.expiryDate);

          if (expiry < now) {
            // Domain expired - delete it and its content
            await kv.delete(['endernet', 'domains', `${domain.name}${domain.tld}`]);
            console.log(`Deleted expired domain: ${domain.name}${domain.tld}`);
          }
        }
      } catch (error) {
        console.error('Error in renewal check:', error);
      }
    }, this.RENEWAL_CHECK_INTERVAL);
  }

  @Command(['net', 'buy'])
  @Description('Purchase a domain name')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain name (e.g. mysite.end)' }
  ])
  async buyDomain({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const domainFull = args.domain.toLowerCase();
    const [name, tld] = domainFull.split('.');

    try {
      // Validate domain format
      if (!name || !tld || !this.VALID_TLDS.includes(`.${tld}`)) {
        throw new Error(`Invalid domain. Valid TLDs: ${this.VALID_TLDS.join(', ')}`);
      }

      // Check if domain exists
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      if (domainResult.value) {
        throw new Error('Domain already registered');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance < this.DOMAIN_COST) {
        throw new Error(`Insufficient funds. Domain costs ${this.DOMAIN_COST} XPL/month`);
      }

      // Create domain record
      const domain: DomainData = {
        name,
        tld: `.${tld}`,
        owner: sender,
        purchaseDate: new Date().toISOString(),
        expiryDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isPublic: true,
        price: null,
        files: {
          'index.tmd': {
            content: '# Welcome\nThis is a new EnderNET site!',
            lastModified: new Date().toISOString()
          }
        }
      };

      // Execute transaction
      const result = await kv.atomic()
        .check({ key: ['plugins', 'economy', 'balances', sender], versionstamp: balanceResult.versionstamp })
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(balance - this.DOMAIN_COST)))
        .set(['endernet', 'domains', domainFull], domain)
        .commit();

      if (!result.ok) {
        throw new Error('Transaction failed');
      }

      const successMsg = container([
        text('🌐 Domain Purchased Successfully! 🌐\n', { style: { color: 'gold', styles: ['bold'] }}),
        text('Domain: ', { style: { color: 'gray' }}),
        text(`${domainFull}\n`, { style: { color: 'green' }}),
        text('Expires: ', { style: { color: 'gray' }}),
        text(new Date(domain.expiryDate).toLocaleDateString() + '\n', { style: { color: 'aqua' }}),
        divider(),
        button('Visit Site', {
          variant: 'success',
          onClick: { action: 'run_command', value: `/net visit ${domainFull}` }
        }),
        text(' '),
        button('Edit Content', {
          variant: 'outline',
          onClick: { action: 'suggest_command', value: `/net edit ${domainFull} index.tmd ` }
        })
      ]);

      log(`${sender} purchased domain ${domainFull}`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Domain Purchase Failed',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'visit'])
  @Description('Visit an EnderNET site')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to visit' }
  ])
  async visitDomain({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const domainFull = args.domain.toLowerCase();

    try {
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (!domain.isPublic && domain.owner !== sender) {
        throw new Error('This site is private');
      }

      const indexContent = domain.files['index.tmd']?.content || 'No content';
      // const parsedContent = parseMarkdown(indexContent);
      const parsedContent = indexContent;

      const siteContainer = container([
        text(`🌐 ${domainFull}\n`, { style: { color: 'gold', styles: ['bold'] }}),
        text(`Owner: ${domain.owner}\n`, { style: { color: 'gray' }}),
        divider(),
        // ...parsedContent,
        text(parsedContent),
        divider(),
        button('View Files', {
          variant: 'outline',
          onClick: { action: 'run_command', value: `/net files ${domainFull}` }
        })
      ]);

      const messages = await tellraw(sender, siteContainer.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'edit'])
  @Description('Edit domain content')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to edit' },
    { name: 'file', type: 'string', description: 'File to edit' },
    { name: 'content', type: 'string', description: 'New content' }
  ])
  async editDomain({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull, file, content } = args;

    try {
      if (!this.VALID_FILES.includes(file)) {
        throw new Error(`Invalid file. Valid files: ${this.VALID_FILES.join(', ')}`);
      }

      if (content.length > this.MAX_FILE_SIZE) {
        throw new Error(`Content exceeds maximum length of ${this.MAX_FILE_SIZE} characters`);
      }

      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (domain.owner !== sender) {
        throw new Error('You do not own this domain');
      }

      domain.files[file] = {
        content,
        lastModified: new Date().toISOString()
      };

      await kv.set(['endernet', 'domains', domainFull], domain);

      const successMsg = container([
        text('✏️ File Updated Successfully!\n', { style: { color: 'green', styles: ['bold'] }}),
        text('File: ', { style: { color: 'gray' }}),
        text(`${file}\n`, { style: { color: 'yellow' }}),
        button('View Site', {
          variant: 'success',
          onClick: { action: 'run_command', value: `/net visit ${domainFull}` }
        })
      ]);

      log(`${sender} updated file ${file} on domain ${domainFull}`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Edit Failed',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  // Additional commands would include:
  // - /net list (list all domains)
  // - /net sell <domain> <price> (list domain for sale)
  // - /net transfer <domain> <player> (transfer ownership)
  // - /net renew <domain> (manually renew domain)
  // - /net files <domain> (list domain files)
  // - /net privacy <domain> <public|private> (toggle domain privacy)

  @Socket('get_domain_data')
  @Permission('player')
  async getDomainData({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { domain } = params;
      const domainResult = await kv.get(['endernet', 'domains', domain]);
      return {
        success: true,
        data: domainResult.value
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('list_domains')
  @Permission('player')
  async listDomains({ kv }: ScriptContext): Promise<any> {
    try {
      const domains = [];
      const iterator = kv.list({ prefix: ['endernet', 'domains'] });
      for await (const entry of iterator) {
        const domain = entry.value as DomainData;
        if (domain.isPublic) {
          domains.push({
            fullDomain: `${domain.name}${domain.tld}`,
            owner: domain.owner,
            expiryDate: domain.expiryDate,
            forSale: domain.price !== null,
            price: domain.price
          });
        }
      }
      return {
        success: true,
        data: domains
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Command(['net', 'list'])
  @Description('List all public domains')
  @Permission('player')
  async netList({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const domains = [];
      const iterator = kv.list({ prefix: ['endernet', 'domains'] });

      for await (const entry of iterator) {
        const domain = entry.value as DomainData;
        if (domain.isPublic || domain.owner === sender) {
          domains.push(domain);
        }
      }

      if (domains.length === 0) {
        throw new Error('No domains found');
      }

      const domainList = container([
        text('📋 EnderNET Domains 📋\n', { style: { color: 'gold', styles: ['bold'] }}),
        divider(),
        ...domains.flatMap(domain => [
          text(`${domain.name}${domain.tld} `, {
            style: { color: domain.price !== null ? 'yellow' : 'white' }
          }),
          text(domain.isPublic ? '🌐' : '🔒', { style: { color: 'gray' }}),
          text(' by ', { style: { color: 'gray' }}),
          text(domain.owner + '\n', { style: { color: 'aqua' }}),
          ...(domain.price !== null ? [
            text(`Price: ${domain.price} XPL `, { style: { color: 'yellow' }}),
            button('Buy', {
              variant: 'success',
              onClick: { action: 'run_command', value: `/net purchase ${domain.name}${domain.tld}` }
            }),
            text('\n')
          ] : []),
          button('Visit', {
            variant: 'outline',
            onClick: { action: 'run_command', value: `/net visit ${domain.name}${domain.tld}` }
          }),
          text('\n'),
          divider()
        ])
      ]);

      const messages = await tellraw(sender, domainList.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'sell'])
  @Description('List a domain for sale')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to sell' },
    { name: 'price', type: 'number', description: 'Selling price in XPL' }
  ])
  async sellDomain({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull, price } = args;

    try {
      if (price <= 0) {
        throw new Error('Price must be positive');
      }

      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (domain.owner !== sender) {
        throw new Error('You do not own this domain');
      }

      domain.price = price;
      await kv.set(['endernet', 'domains', domainFull], domain);

      const successMsg = container([
        text('💰 Domain Listed for Sale 💰\n', { style: { color: 'gold', styles: ['bold'] }}),
        text('Domain: ', { style: { color: 'gray' }}),
        text(`${domainFull}\n`, { style: { color: 'yellow' }}),
        text('Price: ', { style: { color: 'gray' }}),
        text(`${price} XPL\n`, { style: { color: 'green' }}),
        button('Cancel Sale', {
          variant: 'destructive',
          onClick: { action: 'suggest_command', value: `/net sell ${domainFull} 0` }
        })
      ]);

      log(`${sender} listed domain ${domainFull} for sale at ${price} XPL`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'transfer'])
  @Description('Transfer domain ownership')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to transfer' },
    { name: 'player', type: 'player', description: 'New owner' }
  ])
  async transferDomain({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull, player: newOwner } = args;

    try {
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (domain.owner !== sender) {
        throw new Error('You do not own this domain');
      }

      domain.owner = newOwner;
      domain.price = null; // Reset any sale listing
      await kv.set(['endernet', 'domains', domainFull], domain);

      // Notify new owner
      const notifyMsg = container([
        text('🎁 Domain Transfer 🎁\n', { style: { color: 'gold', styles: ['bold'] }}),
        text(`${sender} has transferred `, { style: { color: 'gray' }}),
        text(domainFull, { style: { color: 'yellow' }}),
        text(' to you!\n', { style: { color: 'gray' }}),
        button('Visit Site', {
          variant: 'success',
          onClick: { action: 'run_command', value: `/net visit ${domainFull}` }
        })
      ]);

      await tellraw(newOwner, notifyMsg.render({ platform: 'minecraft', player: newOwner }));

      // Confirm to sender
      const successMsg = container([
        text('✨ Domain Transferred Successfully! ✨\n', { style: { color: 'green', styles: ['bold'] }}),
        text('Domain: ', { style: { color: 'gray' }}),
        text(`${domainFull}\n`, { style: { color: 'yellow' }}),
        text('New Owner: ', { style: { color: 'gray' }}),
        text(newOwner, { style: { color: 'aqua' }})
      ]);

      log(`${sender} transferred domain ${domainFull} to ${newOwner}`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Transfer Failed',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'renew'])
  @Description('Renew a domain for another month')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to renew' }
  ])
  async renewDomain({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull } = args;

    try {
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (domain.owner !== sender) {
        throw new Error('You do not own this domain');
      }

      // Check player balance
      const balanceResult = await kv.get(['plugins', 'economy', 'balances', sender]);
      const balance = balanceResult.value ? Number(balanceResult.value) : 0;

      if (balance < this.DOMAIN_COST) {
        throw new Error(`Insufficient funds. Renewal costs ${this.DOMAIN_COST} XPL`);
      }

      // Calculate new expiry
      const currentExpiry = new Date(domain.expiryDate);
      const newExpiry = new Date(Math.max(Date.now(), currentExpiry.getTime()) + 30 * 24 * 60 * 60 * 1000);
      domain.expiryDate = newExpiry.toISOString();

      // Execute transaction
      const result = await kv.atomic()
        .check({ key: ['plugins', 'economy', 'balances', sender], versionstamp: balanceResult.versionstamp })
        .set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(balance - this.DOMAIN_COST)))
        .set(['endernet', 'domains', domainFull], domain)
        .commit();

      if (!result.ok) {
        throw new Error('Renewal transaction failed');
      }

      const successMsg = container([
        text('🎉 Domain Renewed! 🎉\n', { style: { color: 'gold', styles: ['bold'] }}),
        text('Domain: ', { style: { color: 'gray' }}),
        text(`${domainFull}\n`, { style: { color: 'yellow' }}),
        text('New Expiry: ', { style: { color: 'gray' }}),
        text(newExpiry.toLocaleDateString() + '\n', { style: { color: 'green' }}),
        text('Cost: ', { style: { color: 'gray' }}),
        text(`${this.DOMAIN_COST} XPL`, { style: { color: 'gold' }})
      ]);

      log(`${sender} renewed domain ${domainFull}`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Renewal Failed',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'files'])
  @Description('List files in a domain')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to check' }
  ])
  async listFiles({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull } = args;

    try {
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (!domain.isPublic && domain.owner !== sender) {
        throw new Error('This domain is private');
      }

      const fileList = container([
        text(`📁 Files for ${domainFull}\n`, { style: { color: 'gold', styles: ['bold'] }}),
        divider(),
        ...Object.entries(domain.files).map(([filename, file]) => [
          text(`${filename}\n`, { style: { color: 'yellow' }}),
          text('Last Modified: ', { style: { color: 'gray' }}),
          text(new Date(file.lastModified).toLocaleString() + '\n', { style: { color: 'aqua' }}),
          text('Size: ', { style: { color: 'gray' }}),
          text(`${file.content.length} chars\n`, { style: { color: 'green' }}),
          button('View', {
            variant: 'outline',
            onClick: { action: 'run_command', value: `/net view ${domainFull} ${filename}` }
          }),
          ...(domain.owner === sender ? [
            text(' '),
            button('Edit', {
              variant: 'ghost',
              onClick: { action: 'suggest_command', value: `/net edit ${domainFull} ${filename} ` }
            })
          ] : []),
          text('\n'),
          divider()
        ])
      ]);

      const messages = await tellraw(sender, fileList.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Command(['net', 'privacy'])
  @Description('Toggle domain privacy')
  @Permission('player')
  @Argument([
    { name: 'domain', type: 'string', description: 'Domain to modify' },
    { name: 'privacy', type: 'string', description: 'public or private' }
  ])
  async togglePrivacy({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender, args } = params;
    const { domain: domainFull, privacy } = args;

    try {
      if (!['public', 'private'].includes(privacy)) {
        throw new Error('Privacy must be either "public" or "private"');
      }

      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (domain.owner !== sender) {
        throw new Error('You do not own this domain');
      }

      domain.isPublic = privacy === 'public';
      await kv.set(['endernet', 'domains', domainFull], domain);

      const successMsg = container([
        text('🔐 Privacy Updated 🔐\n', { style: { color: 'gold', styles: ['bold'] }}),
        text('Domain: ', { style: { color: 'gray' }}),
        text(`${domainFull}\n`, { style: { color: 'yellow' }}),
        text('Status: ', { style: { color: 'gray' }}),
        text(privacy.toUpperCase(), { style: { color: privacy === 'public' ? 'green' : 'red' }})
      ]);

      log(`${sender} set domain ${domainFull} to ${privacy}`);
      const messages = await tellraw(sender, successMsg.render({ platform: 'minecraft', player: sender }));
      return { messages };

    } catch (error) {
      const errorMsg = alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      });
      const messages = await tellraw(sender, errorMsg.render({ platform: 'minecraft', player: sender }));
      return { messages, error: error.message };
    }
  }

  @Socket('get_player_domains')
  @Permission('player')
  async getPlayerDomains({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { playerName } = params;
      const domains = [];
      const iterator = kv.list({ prefix: ['endernet', 'domains'] });

      for await (const entry of iterator) {
        const domain = entry.value as DomainData;
        if (domain.owner === playerName) {
          domains.push({
            fullDomain: `${domain.name}${domain.tld}`,
            expiryDate: domain.expiryDate,
            isPublic: domain.isPublic,
            price: domain.price,
            files: Object.keys(domain.files)
          });
        }
      }

      return {
        success: true,
        data: domains
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('get_file_content')
  @Permission('player')
  async getFileContent({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { domain: domainFull, file, requester } = params;
      const domainResult = await kv.get(['endernet', 'domains', domainFull]);
      const domain = domainResult.value as DomainData;

      if (!domain) {
        throw new Error('Domain not found');
      }

      if (!domain.isPublic && domain.owner !== requester) {
        throw new Error('Access denied');
      }

      const fileData = domain.files[file];
      if (!fileData) {
        throw new Error('File not found');
      }

      return {
        success: true,
        data: {
          content: fileData.content,
          lastModified: fileData.lastModified
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  @Socket('check_domain_availability')
  @Permission('player')
  async checkDomainAvailability({ params, kv }: ScriptContext): Promise<any> {
    try {
      const { domain } = params;
      const domainResult = await kv.get(['endernet', 'domains', domain]);

      return {
        success: true,
        data: {
          available: !domainResult.value,
          price: this.DOMAIN_COST
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
