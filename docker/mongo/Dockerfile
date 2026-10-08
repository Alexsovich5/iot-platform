# syntax=docker/dockerfile:1.6
FROM debian:wheezy

ADD --checksum=sha256:7231498ba835e22095843e56d69d3b63f4645d3a434f36bb1ff7bbf4611c478f https://fastdl.mongodb.org/linux/mongodb-linux-x86_64-3.2.3.tgz /tmp/mongo.tgz
RUN tar -xzf /tmp/mongo.tgz -C /usr/local --strip-components=1 \
 && rm /tmp/mongo.tgz \
 && mkdir -p /data/db

EXPOSE 27017
CMD ["mongod", "--bind_ip", "0.0.0.0", "--dbpath", "/data/db"]
