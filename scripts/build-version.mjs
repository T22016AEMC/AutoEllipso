import {execFileSync} from 'node:child_process';
export function resolveBuildCommit(env=process.env,git=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()) {
  const supplied=env.WORKERS_CI_COMMIT_SHA?.trim();
  if(supplied)return supplied;
  try{return git().trim()||'local';}catch{return 'local';}
}
