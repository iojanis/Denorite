import { Module, Event } from '../decorators.ts';
import { ScriptContext } from '../types.ts';
import {getEntityData} from "./modules.ts";

@Module({
  name: 'HelloWorld',
  version: '1.0.0',
  servers: 'all'
})
export class HelloWorld {
  @Event('player_joined')
  async onPlayerJoin({ params, api }: ScriptContext) {
    const item = await getEntityData(api, params.playerName, 'SelectedItem')
    console.dir(item.id)
    await api.tellraw(params.playerName, '{"text":"'+item.id+'","color":"green"}');
  }
}
