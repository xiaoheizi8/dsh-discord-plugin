import React from 'react';
import { Card } from './ui.jsx';

/** 未携带 consoleToken 时的引导页。 */
export default function TokenGate() {
  return (
    <div className="center-screen">
      <Card className="token-card">
        <h2>🔑 需要控制台令牌</h2>
        <p>
          打开方式：<code>http://127.0.0.1:{window.location.port}/?token=你的consoleToken</code>
        </p>
        <p className="muted">
          consoleToken 在项目根目录 config.json 里（首次启动自动生成，桥接启动日志也会打印完整链接）。
          带 ?token= 访问一次即可记住。
        </p>
      </Card>
    </div>
  );
}
