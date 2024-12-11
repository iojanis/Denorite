import {Module, Command, Description, Permission, Event, Argument} from '../decorators.ts';
import type { ScriptContext } from '../types.ts';
import {
  text, alert, button, container, grid, divider,
  tabs, progress, radioGroup, sheet, form, textField
} from '../tellraw-ui.ts';
import { UIComponent } from "../tellraw-ui.ts";

interface EconomyConfig {
  minDepositAmount: number;
  welcomeBonus: number;
  transferFee: number;
}

interface Transaction {
  timestamp: string;
  type: 'deposit' | 'withdraw' | 'transfer' | 'bonus';
  amount: number;
  balance: number;
  description: string;
}

@Module({
  name: 'Economy',
  version: '1.2.0',
})
export class Economy {
  private readonly DEFAULT_CONFIG: EconomyConfig = {
    minDepositAmount: 5,
    welcomeBonus: 10,
    transferFee: 0.1
  };

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async getConfig(kv: any): Promise<EconomyConfig> {
    const config = await kv.get(['plugins', 'economy', 'config']);
    return config.value || this.DEFAULT_CONFIG;
  }

  private async getBalance(kv: any, player: string): Promise<number> {
    const record = await kv.get(['plugins', 'economy', 'balances', player]);
    return record.value ? Number(record.value) : 0;
  }

  private async addTransaction(kv: any, player: string, transaction: Transaction): Promise<void> {
    const key = ['plugins', 'economy', 'transactions', player];
    const existing = await kv.get(key);
    const transactions = existing.value || [];

    transactions.unshift(transaction);
    if (transactions.length > 50) transactions.length = 50;

    await kv.set(key, transactions);
  }

  private renderCurrency(amount: number, showSign = true): UIComponent {
    const isNegative = amount < 0;
    const displayAmount = Math.abs(amount);
    const sign = showSign ? (isNegative ? '-' : '+') : '';

    return text(`${sign}${displayAmount} XPL`, {
      style: {
        color: isNegative ? 'red' : 'green',
        styles: ['bold']
      }
    });
  }

  @Event('player_joined')
  async handlePlayerSync({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { playerName } = params;
    await this.delay(1000);

    const balance = await this.getBalance(kv, playerName);
    const config = await this.getConfig(kv);

    let messages = await tellraw(playerName,
      container([
        text('Welcome to XP Bank', {
          style: { color: 'gold', styles: ['bold'] }
        }),
        this.renderCurrency(balance, false)
      ]).render({ platform: 'minecraft', player: playerName })
    );

    if (balance === 0 && config.welcomeBonus > 0) {
      await kv.set(['plugins', 'economy', 'balances', playerName], new Deno.KvU64(BigInt(config.welcomeBonus)));
      await this.addTransaction(kv, playerName, {
        timestamp: new Date().toISOString(),
        type: 'bonus',
        amount: config.welcomeBonus,
        balance: config.welcomeBonus,
        description: 'Welcome bonus'
      });

      messages = await tellraw(playerName, alert([
        this.renderCurrency(config.welcomeBonus)
      ], {
        variant: 'success',
        title: 'Welcome Bonus Received!'
      }).render({platform: 'minecraft', player: playerName}));
    }

    return { messages };
  }

  @Command(['bank'])
  @Description('Bank management commands')
  @Permission('player')
  async bank({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[] }> {
    const { sender } = params;

    try {
      const balance = await this.getBalance(kv, sender);
      const config = await this.getConfig(kv);

      const messages = await tellraw(sender, container([
        text('XP Bank Menu', {
          style: {color: 'gold', styles: ['bold']}
        }),
        this.renderCurrency(balance, false),
        divider(),
        tabs([
          {
            label: 'Actions',
            content: [
              grid([
                button('Check Balance', {
                  onClick: {
                    action: 'run_command',
                    value: '/bank balance'
                  }
                }),
                button('Transaction History', {
                  onClick: {
                    action: 'run_command',
                    value: '/bank history'
                  }
                })
              ], {columns: 2, gap: 'md'}),
              form([
                textField('amount', {
                  placeholder: `Min: ${config.minDepositAmount} XPL`,
                  required: true
                }),
                radioGroup([
                  {label: 'Deposit', value: 'deposit'},
                  {label: 'Withdraw', value: 'withdraw'}
                ], {
                  name: 'action',
                  defaultValue: 'deposit'
                })
              ], {
                onSubmit: (data) => {
                  const cmd = `/bank ${data.action} ${data.amount}`;
                  return {action: 'run_command', value: cmd};
                }
              })
            ]
          },
          {
            label: 'Send Money',
            content: [
              form([
                textField('recipient', {
                  placeholder: 'Player name',
                  required: true
                }),
                textField('amount', {
                  placeholder: 'Amount to send',
                  required: true
                }),
                text(`Transfer fee: ${config.transferFee} XPL`, {
                  style: {color: 'gray'}
                })
              ], {
                onSubmit: (data) => {
                  const cmd = `/bank send ${data.recipient} ${data.amount}`;
                  return {action: 'run_command', value: cmd};
                }
              })
            ]
          }
        ])
      ]).render({platform: 'minecraft', player: sender}));

      return { messages };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, error: error.message };
    }
  }

  @Command(['bank', 'config'])
  @Description('Configure bank settings')
  @Permission('operator')
  async configureBank({ params, kv, tellraw, log }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;

    try {
      const config = await this.getConfig(kv);

      const messages = await tellraw(sender, sheet([
        text('Bank Settings', {
          style: {color: 'gold', styles: ['bold']}
        }),
        form([
          grid([
            textField('minDepositAmount', {
              placeholder: 'Min deposit',
              defaultValue: config.minDepositAmount.toString()
            }),
            textField('welcomeBonus', {
              placeholder: 'Welcome bonus',
              defaultValue: config.welcomeBonus.toString()
            }),
            textField('transferFee', {
              placeholder: 'Transfer fee',
              defaultValue: config.transferFee.toString()
            })
          ], {columns: 1, gap: 'md'}),
          button('Save Changes', {
            variant: 'success',
            onClick: {
              action: 'run_command',
              value: '/bank config save'
            }
          })
        ], {
          onSubmit: async (data) => {
            const newConfig = {
              minDepositAmount: Math.max(0, Number(data.minDepositAmount)),
              welcomeBonus: Math.max(0, Number(data.welcomeBonus)),
              transferFee: Math.max(0, Number(data.transferFee))
            };

            await kv.set(['plugins', 'economy', 'config'], newConfig);
            log(`Bank config updated by ${sender}`);

            return {action: 'run_command', value: '/bank'};
          }
        })
      ], {
        side: 'right',
        overlay: true
      }).render({platform: 'minecraft', player: sender}));

      return { messages };

    } catch (error) {
      log(`Error in bank configuration: ${error.message}`);
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Configuration Error',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, success: false, error: error.message };
    }
  }

  @Command(['bank', 'balance'])
  @Description('Check your bank balance')
  @Permission('player')
  async checkBalance({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], balance?: number }> {
    const { sender } = params;

    try {
      const balance = await this.getBalance(kv, sender);

      const messages = await tellraw(sender, container([
        text('Bank Balance', {
          style: {color: 'gold', styles: ['bold']}
        }),
        this.renderCurrency(balance, false),
        button('View History', {
          variant: 'outline',
          onClick: {
            action: 'run_command',
            value: '/bank history'
          }
        }),
        button('Return to Menu', {
          variant: 'ghost',
          onClick: {
            action: 'run_command',
            value: '/bank'
          }
        })
      ]).render({platform: 'minecraft', player: sender}));

      return { messages, balance };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, error: error.message };
    }
  }

  @Command(['bank', 'history'])
  @Description('View transaction history')
  @Permission('player')
  async viewHistory({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], transactions?: Transaction[] }> {
    const { sender } = params;

    try {
      const transactions = await kv.get(['plugins', 'economy', 'transactions', sender]);
      const recentTransactions = (transactions.value || []).slice(0, 10);

      const messages = await tellraw(sender, container([
        text('Transaction History', {
          style: {color: 'gold', styles: ['bold']}
        }),
        grid(
          recentTransactions.map(tx => container([
            this.renderCurrency(tx.amount),
            text(tx.description, {style: {color: 'gray'}}),
            text(new Date(tx.timestamp).toLocaleString(), {
              style: {color: 'dark_gray'}
            })
          ])),
          {columns: 1, gap: 'sm'}
        ),
        button('Return to Menu', {
          variant: 'ghost',
          onClick: {
            action: 'run_command',
            value: '/bank'
          }
        })
      ]).render({platform: 'minecraft', player: sender}));

      return { messages, transactions: recentTransactions };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Error',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, error: error.message };
    }
  }

  @Command(['bank', 'deposit'])
  @Description('Deposit XP into your bank account')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to deposit' }
  ])
  async deposit({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;

    try {
      const config = await this.getConfig(kv);
      const amount = Number(args.amount);

      // Validate amount
      if (isNaN(amount) || amount < config.minDepositAmount) {
        throw new Error(`Minimum deposit amount is ${config.minDepositAmount} XPL`);
      }

      // Get current balance and update
      const currentBalance = await this.getBalance(kv, sender);
      const newBalance = currentBalance + amount;

      await kv.set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(newBalance)));

      // Record transaction
      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'deposit',
        amount: amount,
        balance: newBalance,
        description: 'Manual deposit'
      });

      const messages = await tellraw(sender, container([
        alert([
          text('Successfully deposited '),
          this.renderCurrency(amount),
        ], {
          variant: 'success',
          title: 'Deposit Successful',
        }),
        text('New balance: '),
        this.renderCurrency(newBalance, false),
        button('Return to Menu', {
          variant: 'ghost',
          onClick: {
            action: 'run_command',
            value: '/bank'
          }
        })
      ]).render({platform: 'minecraft', player: sender}));

      return { messages, success: true };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Deposit Failed',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, success: false, error: error.message };
    }
  }

  @Command(['bank', 'withdraw'])
  @Description('Withdraw XP from your bank account')
  @Permission('player')
  @Argument([
    { name: 'amount', type: 'integer', description: 'Amount to withdraw' }
  ])
  async withdraw({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;

    try {
      const amount = Number(args.amount);

      // Validate amount
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Withdrawal amount must be greater than 0');
      }

      // Get current balance and validate
      const currentBalance = await this.getBalance(kv, sender);
      if (amount > currentBalance) {
        throw new Error(`Insufficient balance. You have ${currentBalance} XPL`);
      }

      // Update balance
      const newBalance = currentBalance - amount;
      await kv.set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(newBalance)));

      // Record transaction
      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'withdraw',
        amount: amount,
        balance: newBalance,
        description: 'Manual withdrawal'
      });

      const messages = await tellraw(sender, container([
        alert([
          text('Successfully withdrew '),
          this.renderCurrency(-amount),
        ], {
          variant: 'success',
          title: 'Withdrawal Successful',
        }),
        text('New balance: '),
        this.renderCurrency(newBalance, false),
        button('Return to Menu', {
          variant: 'ghost',
          onClick: {
            action: 'run_command',
            value: '/bank'
          }
        })
      ]).render({platform: 'minecraft', player: sender}));

      return { messages, success: true };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Withdrawal Failed',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, success: false, error: error.message };
    }
  }

  @Command(['bank', 'send'])
  @Description('Send XP to another player')
  @Permission('player')
  @Argument([
    { name: 'recipient', type: 'string', description: 'Player to send XP to' },
    { name: 'amount', type: 'integer', description: 'Amount to send' }
  ])
  async send({ params, kv, tellraw }: ScriptContext): Promise<{ messages: any[], success?: boolean }> {
    const { sender, args } = params;

    try {
      const amount = Number(args.amount);
      const recipient = args.recipient;
      const config = await this.getConfig(kv);

      // Validate amount and recipient
      if (isNaN(amount) || amount <= 0) {
        throw new Error('Transfer amount must be greater than 0');
      }

      if (sender === recipient) {
        throw new Error('You cannot send money to yourself');
      }

      // Calculate total cost including fee
      const fee = Math.ceil(amount * config.transferFee);
      const totalCost = amount + fee;

      // Check sender's balance
      const senderBalance = await this.getBalance(kv, sender);
      if (totalCost > senderBalance) {
        throw new Error(`Insufficient balance. Required: ${totalCost} XPL (including ${fee} XPL fee)`);
      }

      // Get recipient's balance
      const recipientBalance = await this.getBalance(kv, recipient);

      // Update balances
      const newSenderBalance = senderBalance - totalCost;
      const newRecipientBalance = recipientBalance + amount;

      await kv.set(['plugins', 'economy', 'balances', sender], new Deno.KvU64(BigInt(newSenderBalance)));
      await kv.set(['plugins', 'economy', 'balances', recipient], new Deno.KvU64(BigInt(newRecipientBalance)));

      // Record transactions
      await this.addTransaction(kv, sender, {
        timestamp: new Date().toISOString(),
        type: 'transfer',
        amount: -totalCost,
        balance: newSenderBalance,
        description: `Sent ${amount} XPL to ${recipient} (Fee: ${fee} XPL)`
      });

      await this.addTransaction(kv, recipient, {
        timestamp: new Date().toISOString(),
        type: 'transfer',
        amount: amount,
        balance: newRecipientBalance,
        description: `Received ${amount} XPL from ${sender}`
      });

      // Notify sender
      const senderMessages = await tellraw(sender, container([
        alert([
          text('Successfully sent '),
          this.renderCurrency(amount),
          text(` to ${recipient}`),
          text(`\nTransfer fee: `),
          this.renderCurrency(-fee)
        ], {
          variant: 'success',
          title: 'Transfer Successful',
        }),
        text('New balance: '),
        this.renderCurrency(newSenderBalance, false),
        button('Return to Menu', {
          variant: 'ghost',
          onClick: {
            action: 'run_command',
            value: '/bank'
          }
        })
      ]).render({platform: 'minecraft', player: sender}));

      // Notify recipient
      const recipientMessages = await tellraw(recipient, alert([
        text('You received '),
        this.renderCurrency(amount),
        text(` from ${sender}`)
      ], {
        variant: 'success',
        title: 'Transfer Received',
        description: `Your new balance is ${newRecipientBalance} XPL`
      }).render({platform: 'minecraft', player: recipient}));

      return { messages: [...senderMessages, ...recipientMessages], success: true };

    } catch (error) {
      const messages = await tellraw(sender, alert([], {
        variant: 'destructive',
        title: 'Transfer Failed',
        description: error.message
      }).render({platform: 'minecraft', player: sender}));

      return { messages, success: false, error: error.message };
    }
  }
}
