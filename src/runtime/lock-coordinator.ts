import { acquireMutationLock } from "../storage/lock.js";

export class RuntimeLockCoordinator {
  private releaseFn:(()=>Promise<void>)|undefined;
  constructor(readonly root:string){}

  get mutationOwned():boolean{return Boolean(this.releaseFn);}

  async ensureMutationAccess():Promise<void>{
    if(!this.releaseFn)this.releaseFn=await acquireMutationLock(this.root);
  }

  async release():Promise<void>{
    const release=this.releaseFn;
    this.releaseFn=undefined;
    if(release)await release();
  }
}
