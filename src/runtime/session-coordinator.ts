import type { StateStore } from "../storage/state.js";

export class SessionCoordinator {
  private currentId:string|undefined;
  constructor(
    readonly root:string,
    readonly repoIdentity:string,
    readonly store:StateStore,
    initialSessionId?:string,
  ){
    if(initialSessionId){
      store.ensureSession(root,repoIdentity,initialSessionId);
      this.currentId=initialSessionId;
    }
  }

  get sessionId():string|undefined{return this.currentId;}
  get hasSession():boolean{return Boolean(this.currentId);}

  ensure():string{
    if(!this.currentId)this.currentId=this.store.createSession(this.root,this.repoIdentity);
    return this.currentId;
  }

  createNew():string{
    this.currentId=this.store.createSession(this.root,this.repoIdentity);
    return this.currentId;
  }

  resume(sessionId:string):string{
    this.store.ensureSession(this.root,this.repoIdentity,sessionId);
    this.currentId=sessionId;
    return sessionId;
  }

  clearActive():void{this.currentId=undefined;}
}
