FROM postgres:16-alpine
COPY backup.sh /backup.sh
RUN chmod +x /backup.sh
CMD ["/backup.sh"]
