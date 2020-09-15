FROM ubuntu:18.04

WORKDIR /uitest

RUN apt-get update && \
    apt-get install -y apt-transport-https curl git libasound2 python3 python3-pip xvfb libgbm-dev && \
    curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor > packages.microsoft.gpg && \
    install -o root -g root -m 644 packages.microsoft.gpg /etc/apt/trusted.gpg.d/ && \
    sh -c 'echo "deb [arch=amd64 signed-by=/etc/apt/trusted.gpg.d/packages.microsoft.gpg] https://packages.microsoft.com/repos/vscode stable main" > /etc/apt/sources.list.d/vscode.list' && \
    curl -sL https://deb.nodesource.com/setup_12.x | bash && \
    apt-get update && \
    apt-get install -y code nodejs && \
    apt-get purge -y --auto-remove apt-transport-https curl && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN npm run ci:all && \
    cd backend && npm run setup && cd .. && \
    npm run ui-test:setup && \
    npm run ui-test:compile

ENTRYPOINT ["./containers/ubuntu-test/entrypoint.sh"]
