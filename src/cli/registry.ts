export interface CliCommandContext {
  json:boolean;
  args:string[];
  print(value:unknown):void;
  printJson(value:unknown):void;
  printText(value:string):void;
  confirm(question:string):Promise<boolean>;
}

export interface CliCommand {
  name:string;
  aliases?:string[];
  usage:string;
  description:string;
  requiresSession?:boolean;
  requiresMutationLock?:boolean;
  execute(ctx:CliCommandContext):Promise<void>;
}

export class CliCommandRegistry {
  private readonly byName=new Map<string,CliCommand>();

  register(command:CliCommand):void{
    for(const name of [command.name,...(command.aliases??[])]){
      if(this.byName.has(name))throw new Error(`Duplicate CLI command ${name}`);
      this.byName.set(name,command);
    }
  }

  get(name:string):CliCommand|undefined{return this.byName.get(name);}

  list():CliCommand[]{
    return [...new Set(this.byName.values())].sort((a,b)=>a.name.localeCompare(b.name));
  }

  help(title="Macus Code"):string{
    const rows=this.list();
    const width=Math.max(...rows.map(x=>x.usage.length),0);
    return [title,"","Commands:",...rows.map(x=>`  ${x.usage.padEnd(width)}  ${x.description}`)].join("\n");
  }
}
