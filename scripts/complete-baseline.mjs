import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const git=process.env.AUTOELLIPSO_GIT||'git',root=path.resolve(import.meta.dirname,'..');
const temporaryIndex=path.join(root,'.baseline-index');
const env={...process.env,GIT_INDEX_FILE:temporaryIndex};
const run=args=>execFileSync(git,args,{cwd:root,env,encoding:'utf8'}).trim();
try {
  run(['read-tree','1e1fcd6']);
  run(['add','-f','public/assets/aistudio/.gitignore']);
  const tree=run(['write-tree']);
  const commit=run(['-c','user.name=AutoEllipso V2','-c','user.email=autoellipso-v2@local.invalid','commit-tree',tree,'-p','1e1fcd6','-m','baseline: include original self-ignored asset directory metadata']);
  run(['update-ref','refs/heads/original-baseline',commit]);console.log('Complete original baseline: '+commit);
} finally {if(fs.existsSync(temporaryIndex))fs.unlinkSync(temporaryIndex);}
